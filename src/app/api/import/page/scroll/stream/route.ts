/**
 * Streaming SSE endpoint for scroll-based image import.
 * 
 * Sends events as images are discovered during scrolling:
 * - status: Progress updates (scroll count, message)
 * - image: Individual image found
 * - done: Scan complete with final count
 * - error: Error occurred
 */

import { NextRequest } from 'next/server';
import {
  isBlockedMediaDomain,
  looksLikeImageAssetUrl,
  looksLikeTinyTrackingPixel,
  looksLikeTrackingOrUtilityAsset,
  looksLikeUiChromeAsset,
} from '@/server/pageImportFilters';
import {
  buildArchiveChallengeMessage,
  inspectArchiveText,
  isArchiveHost,
  logArchiveDiagnostics,
} from '@/server/archiveDiagnostics';
import {
  cookieHeaderToPuppeteerCookies,
  normalizeCookieHeader,
} from '@/server/pageImportCookies';

// Puppeteer types - we use any since it's an optional dependency
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let puppeteer: any = null;

const loadPuppeteer = async () => {
  if (puppeteer) return puppeteer;
  try {
    puppeteer = await (Function('return import("puppeteer")')());
    return puppeteer;
  } catch {
    return null;
  }
};

const DEFAULT_MAX_SCROLLS = 10;
const AUTO_SCROLL_SAFETY_CAP = 200;
const DEFAULT_SCROLL_DELAY_MS = 1500;
const DEFAULT_TIMEOUT_MS = 30000;
const NO_NEW_IMAGE_STOP_THRESHOLD = 3;

const isValidUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
};

const isPrivateHost = (hostname: string) => {
  const lowered = hostname.toLowerCase();
  if (lowered === 'localhost') return true;
  const ipv4Match = /^(\d{1,3}\.){3}\d{1,3}$/.test(lowered);
  if (!ipv4Match) return false;
  const octets = lowered.split('.').map((part) => Number(part));
  if (octets.some((value) => Number.isNaN(value) || value < 0 || value > 255)) {
    return true;
  }
  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
};

const getArchivePageDiagnostics = async (
  pageUrl: string,
  page: {
    title: () => Promise<string>;
    evaluate: <T>(pageFunction: () => T | Promise<T>) => Promise<T>;
    url: () => string;
  },
  status?: number
) => {
  if (!isArchiveHost(pageUrl) && !isArchiveHost(page.url())) {
    return null;
  }

  const [title, text] = await Promise.all([
    page.title().catch(() => ''),
    page.evaluate(() => document.body?.innerText?.slice(0, 4000) || '').catch(() => ''),
  ]);

  return inspectArchiveText({
    sourceUrl: pageUrl,
    finalUrl: page.url(),
    status,
    contentType: 'text/html',
    title,
    text,
  });
};

interface ImageInfo {
  kind: 'image';
  url: string;
  filename: string;
  naturalWidth?: number;
  naturalHeight?: number;
  contentLength?: number;
  inMainContent?: boolean;
  inUiChrome?: boolean;
}

interface VideoInfo {
  kind: 'video';
  url: string;
  filename: string;
  posterUrl?: string;
  isBlob: boolean;
}

type MediaInfo = ImageInfo | VideoInfo;

const pickBestFromSrcset = (srcset: string): string => {
  if (!srcset) return '';
  
  const candidates: Array<{ url: string; score: number }> = [];
  const parts = srcset.split(',');
  
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    
    const [url, descriptor] = trimmed.split(/\s+/, 2);
    let score = 1;
    
    if (descriptor?.endsWith('w')) {
      const width = Number(descriptor.slice(0, -1));
      score = Number.isFinite(width) ? width : 0;
    } else if (descriptor?.endsWith('x')) {
      const ratio = Number(descriptor.slice(0, -1));
      score = Number.isFinite(ratio) ? ratio * 1000 : 0;
    }
    
    candidates.push({ url, score });
  }
  
  if (candidates.length === 0) return '';
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].url;
};

const getFilenameFromUrl = (value: string): string => {
  try {
    const parsed = new URL(value);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const filename = segments[segments.length - 1] || 'remote-image';
    return decodeURIComponent(filename).replace(/[?#].*$/, '');
  } catch {
    return 'remote-image';
  }
};

const inferVideoFileName = (value: string, fallback = 'remote-video.mp4'): string => {
  try {
    const parsed = new URL(value);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const filename = segments[segments.length - 1];
    if (!filename) return fallback;
    return decodeURIComponent(filename).replace(/[?#].*$/, '');
  } catch {
    const trimmed = value.trim();
    return trimmed || fallback;
  }
};

const resolveCandidateUrl = (rawUrl: string, baseUrl: string): string | null => {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('javascript:')) {
    return null;
  }

  try {
    const resolved = new URL(trimmed, baseUrl);
    if (!['http:', 'https:'].includes(resolved.protocol)) return null;
    if (isPrivateHost(resolved.hostname)) return null;
    resolved.hash = '';
    return resolved.toString();
  } catch {
    return null;
  }
};

const MIN_DIMENSION = 50;

// Check if URL contains size hints suggesting it's a real image
const urlHasSizeHints = (url: string): boolean => {
  // Match patterns like 800x800, 300w, @2x, etc. indicating real image dimensions
  return /(\d{2,}x\d{2,})|(_\d{3,}w)|(@[23]x)/i.test(url);
};

const shouldIncludeImageWithOptions = (
  img: ImageInfo,
  options?: { includeUiChrome?: boolean; includeSmallAssets?: boolean }
): boolean => {
  const includeUiChrome = Boolean(options?.includeUiChrome);
  const includeSmallAssets = Boolean(options?.includeSmallAssets);
  if (isBlockedMediaDomain(img.url)) return false;
  if (!includeUiChrome && looksLikeUiChromeAsset(img.url, img.filename)) return false;
  if (looksLikeTrackingOrUtilityAsset(img.url, img.filename)) return false;
  if (looksLikeTinyTrackingPixel({
    url: img.url,
    filenameHint: img.filename,
    naturalWidth: img.naturalWidth,
    naturalHeight: img.naturalHeight,
    contentLength: img.contentLength,
  })) return false;
  // If URL has size hints (like 800x800), trust it even if naturalWidth/Height are tiny
  // This handles lazy-loaded images where the actual image hasn't loaded yet
  if (urlHasSizeHints(img.url)) {
    return true;
  }
  
  if (img.naturalWidth && img.naturalHeight) {
    if (!includeSmallAssets && img.naturalWidth < MIN_DIMENSION && img.naturalHeight < MIN_DIMENSION) {
      return false;
    }
    return true;
  }
  
  return looksLikeImageAssetUrl(img.url);
};

export async function POST(request: NextRequest) {
  const body = await request.json();
  const pageUrl = typeof body?.url === 'string' ? body.url.trim() : '';
  const includeUiChrome = Boolean(body?.includeUiChrome);
  const includeSmallAssets = Boolean(body?.includeSmallAssets);
  let cookieHeader: string | null = null;
  try {
    cookieHeader = normalizeCookieHeader(body?.cookieHeader);
  } catch (error) {
    return new Response(
      `event: error\ndata: ${JSON.stringify({ error: error instanceof Error ? error.message : 'Invalid cookie header' })}\n\n`,
      { status: 400, headers: { 'Content-Type': 'text/event-stream' } }
    );
  }
  const requestedMaxScrolls = Number.isFinite(body?.maxScrolls)
    ? Math.max(1, Math.min(50, Number(body.maxScrolls))) 
    : Number(process.env.IMPORT_SCROLL_MAX_SCROLLS) || DEFAULT_MAX_SCROLLS;
  const autoScrollUntilStable = Boolean(body?.autoScrollUntilStable);
  const maxScrolls = autoScrollUntilStable ? AUTO_SCROLL_SAFETY_CAP : requestedMaxScrolls;
  const maxPages = Number.isFinite(body?.maxPages)
    ? Math.max(1, Math.min(20, Number(body.maxPages)))
    : 1; // Default to single page unless specified
  const scrollDelayMs = Number.isFinite(body?.scrollDelayMs)
    ? Math.max(500, Math.min(5000, Number(body.scrollDelayMs)))
    : DEFAULT_SCROLL_DELAY_MS;
  const timeoutMs = Number(process.env.IMPORT_SCROLL_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

  if (!pageUrl || !isValidUrl(pageUrl)) {
    return new Response(
      `event: error\ndata: ${JSON.stringify({ error: 'A valid page URL is required' })}\n\n`,
      { status: 400, headers: { 'Content-Type': 'text/event-stream' } }
    );
  }

  const parsed = new URL(pageUrl);
  if (isPrivateHost(parsed.hostname)) {
    return new Response(
      `event: error\ndata: ${JSON.stringify({ error: 'Private or localhost URLs are not allowed' })}\n\n`,
      { status: 400, headers: { 'Content-Type': 'text/event-stream' } }
    );
  }

  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const pup = await loadPuppeteer();
      if (!pup) {
        send('error', { error: 'Puppeteer not installed. Run: npm install puppeteer' });
        controller.close();
        return;
      }

      let browser;
      try {
        send('status', { message: 'Launching browser...', scrollCount: 0, imageCount: 0, pageNum: 1 });

        browser = await pup.launch({
          headless: true,
          executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-extensions',
          ],
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 900 });
        if (cookieHeader) {
          const cookies = cookieHeaderToPuppeteerCookies(pageUrl, cookieHeader);
          if (cookies.length > 0) {
            await page.setCookie(...cookies);
          }
        }
        await page.setUserAgent(
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        );

        const seenMedia = new Set<string>();
        const sentMedia = new Set<string>();
        const networkImageCandidates = new Map<string, { trusted: boolean; contentLength?: number }>();
        let totalMediaSent = 0;
        let totalScrollCount = 0;
        let currentPageNum = 1;
        let currentUrl = pageUrl;
        const visitedPages = new Set<string>();
        let stoppedByScrollCap = false;
        const targetHost = new URL(pageUrl).hostname.toLowerCase();
        const isMcMasterHost = targetHost === 'mcmaster.com' || targetHost.endsWith('.mcmaster.com');
        let sawProdPage403 = false;
        let sawProtectionPayload = false;

        const queueNetworkImage = (
          rawUrl: string,
          pageLocation: string,
          opts?: { contentType?: string; resourceType?: string; contentLength?: number }
        ) => {
          const resolved = resolveCandidateUrl(rawUrl, pageLocation);
          if (!resolved) return;
          if (isBlockedMediaDomain(resolved)) return;
          if (!includeUiChrome && looksLikeUiChromeAsset(resolved)) return;
          if (looksLikeTrackingOrUtilityAsset(resolved)) return;
          if (looksLikeTinyTrackingPixel({ url: resolved })) return;

          const contentType = (opts?.contentType || '').toLowerCase();
          const trusted = contentType.startsWith('image/') || opts?.resourceType === 'image';
          const contentLength =
            typeof opts?.contentLength === 'number' && Number.isFinite(opts.contentLength) && opts.contentLength > 0
              ? opts.contentLength
              : undefined;
          if (!trusted && !looksLikeImageAssetUrl(resolved)) return;

          const current = networkImageCandidates.get(resolved);
          if (!current) {
            networkImageCandidates.set(resolved, { trusted, contentLength });
          } else if (trusted && !current.trusted) {
            current.trusted = true;
          }
          if (typeof contentLength === 'number' && Number.isFinite(contentLength) && contentLength > 0) {
            if (current) {
              current.contentLength = contentLength;
            } else {
              networkImageCandidates.set(resolved, { trusted, contentLength });
            }
          }
        };

        page.on('response', (response: { request: () => { resourceType?: () => string }; url: () => string; headers: () => Record<string, string>; status: () => number }) => {
          try {
            const url = response.url();
            if (!url) return;
            if (isMcMasterHost) {
              if (url.includes('ProdPageWebPart.aspx') && response.status() === 403) {
                sawProdPage403 = true;
              }
              if (url.includes('prodDatProtection.aspx') && response.status() === 200) {
                sawProtectionPayload = true;
              }
            }
            const resourceType = response.request()?.resourceType?.() || '';
            const headers = response.headers();
            const contentType = headers?.['content-type'] || '';
            const parsedContentLength = Number(headers?.['content-length']);
            const contentLength = Number.isFinite(parsedContentLength) && parsedContentLength > 0
              ? parsedContentLength
              : undefined;
            if (resourceType === 'image' || contentType.toLowerCase().startsWith('image/')) {
              queueNetworkImage(url, pageUrl, { contentType, resourceType, contentLength });
            }
          } catch {
            // Ignore best-effort network capture failures.
          }
        });

        // Helper to trigger all lazy-loaded images by scrolling through the page
        const triggerLazyLoad = async () => {
          await page.evaluate(async () => {
            const pickScrollTarget = (): { kind: 'window' | 'element'; element: HTMLElement | null } => {
              const root = (document.scrollingElement as HTMLElement | null) || document.documentElement;
              const windowDelta = Math.max(0, root.scrollHeight - window.innerHeight);

              let bestElement: HTMLElement | null = null;
              let bestDelta = 0;
              const candidates = Array.from(document.querySelectorAll<HTMLElement>('main, [role="main"], section, article, div'));
              for (const el of candidates) {
                if (!el || el === root || el === document.body) continue;
                const style = window.getComputedStyle(el);
                const overflowY = style.overflowY;
                if (overflowY !== 'auto' && overflowY !== 'scroll' && overflowY !== 'overlay') continue;
                const delta = el.scrollHeight - el.clientHeight;
                if (delta < 300 || el.clientHeight < 220) continue;
                if (delta > bestDelta) {
                  bestDelta = delta;
                  bestElement = el;
                }
              }

              if (bestElement && bestDelta > windowDelta + 200) {
                return { kind: 'element', element: bestElement };
              }
              return { kind: 'window', element: null };
            };

            const target = pickScrollTarget();
            if (target.kind === 'element' && target.element) {
              const el = target.element;
              const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
              const step = Math.max(120, el.clientHeight * 0.8);
              for (let y = 0; y <= maxTop; y += step) {
                el.scrollTop = Math.min(maxTop, y);
                el.dispatchEvent(new Event('scroll', { bubbles: true }));
                await new Promise(r => setTimeout(r, 120));
              }
              el.scrollTop = 0;
              el.dispatchEvent(new Event('scroll', { bubbles: true }));
              await new Promise(r => setTimeout(r, 220));
              return;
            }

            // Fallback: scroll the main document/window
            const scrollHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
            const viewHeight = window.innerHeight;
            const step = Math.max(120, viewHeight * 0.8);
            for (let y = 0; y < scrollHeight; y += step) {
              window.scrollTo(0, y);
              window.dispatchEvent(new Event('scroll'));
              await new Promise(r => setTimeout(r, 100));
            }

            window.scrollTo(0, 0);
            window.dispatchEvent(new Event('scroll'));
            await new Promise(r => setTimeout(r, 200));
          });
          
          // Wait for images to start loading
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          try {
            await page.waitForNetworkIdle({ timeout: 3000 });
          } catch {
            // Continue anyway
          }
        };

        // Helper to extract and process media (images + videos)
        const extractAndSendNewImages = async () => {
          const pageLocation = await page.evaluate(() => window.location.href);
          const allMedia = await page.evaluate(() => {
            const imgs = Array.from(document.querySelectorAll('img'));
            const sources = Array.from(document.querySelectorAll('source'));
            const videos = Array.from(document.querySelectorAll('video'));
            
            const results: Array<{
              mediaKind: 'image' | 'video';
              src: string;
              srcset: string;
              dataSrcset: string;
              dataSrc: string;
              naturalWidth: number;
              naturalHeight: number;
              poster: string;
              inMainContent: boolean;
              inUiChrome: boolean;
            }> = [];
            const classifyContext = (element: Element | null): { inMainContent: boolean; inUiChrome: boolean } => {
              let inMainContent = false;
              let inUiChrome = false;
              let current: Element | null = element;
              while (current) {
                const tagName = current.tagName.toLowerCase();
                const role = (current.getAttribute('role') || '').toLowerCase();
                const id = (current.getAttribute('id') || '').toLowerCase();
                const className = (current.getAttribute('class') || '').toLowerCase();
                const ariaLabel = (current.getAttribute('aria-label') || '').toLowerCase();
                const signal = `${id} ${className} ${ariaLabel}`;
                if (
                  tagName === 'main' ||
                  tagName === 'article' ||
                  role === 'main' ||
                  signal.includes('product') ||
                  signal.includes('content')
                ) {
                  inMainContent = true;
                }
                if (
                  tagName === 'header' ||
                  tagName === 'nav' ||
                  tagName === 'footer' ||
                  role === 'navigation' ||
                  signal.includes('menu') ||
                  signal.includes('nav') ||
                  signal.includes('header') ||
                  signal.includes('footer') ||
                  signal.includes('masthead') ||
                  signal.includes('browsecatalog')
                ) {
                  inUiChrome = true;
                }
                current = current.parentElement;
              }
              return { inMainContent, inUiChrome };
            };
            const pushBackgroundUrls = (value: string | null | undefined, sourceElement?: Element | null) => {
              if (!value || value === 'none') return;
              const urlRegex = /url\((['"]?)(.*?)\1\)/g;
              let match: RegExpExecArray | null;
              while ((match = urlRegex.exec(value)) !== null) {
                const candidate = (match[2] || '').trim();
                if (!candidate || candidate.startsWith('data:')) continue;
                const context = classifyContext(sourceElement || null);
                results.push({
                  mediaKind: 'image',
                  src: candidate,
                  srcset: '',
                  dataSrcset: '',
                  dataSrc: '',
                  naturalWidth: 0,
                  naturalHeight: 0,
                  poster: '',
                  inMainContent: context.inMainContent,
                  inUiChrome: context.inUiChrome,
                });
              }
            };

            for (const img of imgs) {
              const context = classifyContext(img);
              results.push({
                mediaKind: 'image',
                src: img.currentSrc || img.src || '',
                srcset: img.srcset || '',
                dataSrcset: img.dataset.srcset || img.getAttribute('data-srcset') || '',
                dataSrc: img.dataset.src || img.dataset.lazySrc || img.dataset.original || img.getAttribute('data-lazy') || '',
                naturalWidth: img.naturalWidth || 0,
                naturalHeight: img.naturalHeight || 0,
                poster: '',
                inMainContent: context.inMainContent,
                inUiChrome: context.inUiChrome,
              });
            }

            for (const source of sources) {
              const context = classifyContext(source);
              results.push({
                mediaKind: 'image',
                src: '',
                srcset: source.srcset || '',
                dataSrcset: source.dataset?.srcset || source.getAttribute('data-srcset') || '',
                dataSrc: source.dataset?.src || '',
                naturalWidth: 0,
                naturalHeight: 0,
                poster: '',
                inMainContent: context.inMainContent,
                inUiChrome: context.inUiChrome,
              });
            }

            for (const video of videos) {
              const source = video.querySelector('source');
              const src = video.currentSrc || video.src || source?.src || '';
              const filenameHint = video.getAttribute('aria-label') || video.getAttribute('title') || src;
              const context = classifyContext(video);
              results.push({
                mediaKind: 'video',
                src,
                srcset: '',
                dataSrcset: '',
                dataSrc: filenameHint,
                naturalWidth: video.videoWidth || 0,
                naturalHeight: video.videoHeight || 0,
                poster: video.poster || '',
                inMainContent: context.inMainContent,
                inUiChrome: context.inUiChrome,
              });
            }

            for (const link of Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="image"]'))) {
              if (!link.href) continue;
              const context = classifyContext(link);
              results.push({
                mediaKind: 'image',
                src: link.href,
                srcset: '',
                dataSrcset: '',
                dataSrc: '',
                naturalWidth: 0,
                naturalHeight: 0,
                poster: '',
                inMainContent: context.inMainContent,
                inUiChrome: context.inUiChrome,
              });
            }

            for (const element of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
              const inlineStyle = element.getAttribute('style');
              if (inlineStyle && inlineStyle.includes('background')) {
                pushBackgroundUrls(inlineStyle, element);
              }
              const computedBackground = window.getComputedStyle(element).backgroundImage;
              pushBackgroundUrls(computedBackground, element);
            }

            return results;
          });

          let newCount = 0;
          
          for (const img of allMedia) {
            // Prioritize data-srcset over srcset (lazy loaders put high-res versions there)
            // Then check srcset, then data-src, then src
            const srcsetUrl = pickBestFromSrcset(img.dataSrcset) || pickBestFromSrcset(img.srcset);
            const rawUrl = srcsetUrl || img.dataSrc || img.src;
            if (!rawUrl) continue;
            
            try {
              const isBlob = rawUrl.startsWith('blob:');
              const cleanUrl = isBlob ? rawUrl : resolveCandidateUrl(rawUrl, pageLocation);
              if (!cleanUrl) continue;
              const dedupeKey = `${img.mediaKind}:${cleanUrl}`;
              
              if (seenMedia.has(dedupeKey)) continue;

              const mediaInfo: MediaInfo =
                img.mediaKind === 'video'
                  ? {
                      kind: 'video',
                      url: cleanUrl,
                      filename: inferVideoFileName(img.dataSrc || cleanUrl),
                      posterUrl: img.poster ? new URL(img.poster, pageLocation).toString() : undefined,
                      isBlob,
                    }
                  : {
                      kind: 'image',
                      url: cleanUrl,
                      filename: getFilenameFromUrl(cleanUrl),
                      naturalWidth: img.naturalWidth || undefined,
                      naturalHeight: img.naturalHeight || undefined,
                      inMainContent: img.inMainContent || undefined,
                      inUiChrome: img.inUiChrome || undefined,
                    };

              if (mediaInfo.kind === 'image' && !shouldIncludeImageWithOptions(mediaInfo, { includeUiChrome, includeSmallAssets })) {
                seenMedia.add(dedupeKey);
                continue;
              }
              if (
                mediaInfo.kind === 'image' &&
                sawProdPage403 &&
                sawProtectionPayload &&
                !/\/contents\/gfx\/imagecache\//i.test(mediaInfo.url)
              ) {
                seenMedia.add(dedupeKey);
                continue;
              }

              seenMedia.add(dedupeKey);
              newCount++;

              // Only send if not already sent
              if (!sentMedia.has(dedupeKey)) {
                sentMedia.add(dedupeKey);
                totalMediaSent++;
                send('media', mediaInfo);
                if (mediaInfo.kind === 'image') {
                  send('image', mediaInfo);
                } else {
                  send('video', mediaInfo);
                }
              }
            } catch {
              // Invalid URL, skip
            }
          }

          for (const [networkUrl, metadata] of networkImageCandidates.entries()) {
            const dedupeKey = `image:${networkUrl}`;
            if (seenMedia.has(dedupeKey)) continue;

            const mediaInfo: ImageInfo = {
              kind: 'image',
              url: networkUrl,
              filename: getFilenameFromUrl(networkUrl),
              contentLength: metadata.contentLength,
            };

            if (looksLikeTinyTrackingPixel({
              url: mediaInfo.url,
              filenameHint: mediaInfo.filename,
              contentLength: mediaInfo.contentLength,
            })) {
              seenMedia.add(dedupeKey);
              continue;
            }
            if (!metadata.trusted && !shouldIncludeImageWithOptions(mediaInfo, { includeUiChrome, includeSmallAssets })) {
              seenMedia.add(dedupeKey);
              continue;
            }
            if (
              sawProdPage403 &&
              sawProtectionPayload &&
              !/\/contents\/gfx\/imagecache\//i.test(mediaInfo.url)
            ) {
              seenMedia.add(dedupeKey);
              continue;
            }

            seenMedia.add(dedupeKey);
            newCount++;
            if (!sentMedia.has(dedupeKey)) {
              sentMedia.add(dedupeKey);
              totalMediaSent++;
              send('media', mediaInfo);
              send('image', mediaInfo);
            }
          }
          
          return newCount;
        };

        // Helper to find next page link
        const findNextPageUrl = async (): Promise<string | null> => {
          return await page.evaluate(() => {
            // Look for rel="next" link first
            const nextLink = document.querySelector('link[rel="next"]') as HTMLLinkElement;
            if (nextLink?.href) return nextLink.href;
            
            // Look for pagination links with "next" text or arrows
            const paginationLinks = Array.from(document.querySelectorAll('a[href*="page="], a.next, a[rel="next"], .pagination a'));
            for (const link of paginationLinks) {
              const el = link as HTMLAnchorElement;
              const text = el.textContent?.toLowerCase() || '';
              if (text.includes('next') || text.includes('→') || text.includes('›') || el.rel === 'next') {
                return el.href;
              }
            }
            
            // Look for page=N+1 pattern
            const currentPageMatch = window.location.search.match(/page=(\d+)/);
            const currentPage = currentPageMatch ? parseInt(currentPageMatch[1], 10) : 1;
            const nextPageLinks = Array.from(document.querySelectorAll(`a[href*="page=${currentPage + 1}"]`)) as HTMLAnchorElement[];
            if (nextPageLinks.length > 0) {
              return nextPageLinks[0].href;
            }
            
            return null;
          });
        };

        // Process pages
        while (currentPageNum <= maxPages) {
          visitedPages.add(currentUrl);
          
          send('status', { 
            message: maxPages > 1 ? `Loading page ${currentPageNum}...` : 'Loading page...', 
            scrollCount: totalScrollCount, 
            imageCount: totalMediaSent,
            pageNum: currentPageNum
          });

          const navigationResponse = await page.goto(currentUrl, {
            waitUntil: 'networkidle2',
            timeout: timeoutMs,
          });

          await new Promise(resolve => setTimeout(resolve, 1000));
          const archiveDiagnostics = await getArchivePageDiagnostics(currentUrl, page, navigationResponse?.status?.());
          logArchiveDiagnostics('import/page/scroll/stream', archiveDiagnostics, {
            phase: 'page-load',
            pageNum: currentPageNum,
          });
          if (archiveDiagnostics?.challengeDetected) {
            send('error', {
              error: buildArchiveChallengeMessage(archiveDiagnostics.host),
              details: { archiveDiagnostics },
            });
            return;
          }

          // Trigger lazy loading by scrolling through the page first
          send('status', { 
            message: maxPages > 1 ? `Triggering lazy load on page ${currentPageNum}...` : 'Triggering lazy load...', 
            scrollCount: totalScrollCount, 
            imageCount: totalMediaSent,
            pageNum: currentPageNum
          });
          await triggerLazyLoad();

          // Initial extraction for this page
          send('status', { 
            message: maxPages > 1 ? `Scanning page ${currentPageNum}...` : 'Scanning page...', 
            scrollCount: totalScrollCount, 
            imageCount: totalMediaSent,
            pageNum: currentPageNum
          });
          await extractAndSendNewImages();

          // Scroll within this page
          let pageScrollCount = 0;
          let noNewImagesCount = 0;
          
          while (pageScrollCount < maxScrolls && noNewImagesCount < NO_NEW_IMAGE_STOP_THRESHOLD) {
            const scrollStep = await page.evaluate(() => {
              const root = (document.scrollingElement as HTMLElement | null) || document.documentElement;
              const windowDelta = Math.max(0, root.scrollHeight - window.innerHeight);

              let bestElement: HTMLElement | null = null;
              let bestDelta = 0;
              const candidates = Array.from(document.querySelectorAll<HTMLElement>('main, [role="main"], section, article, div'));
              for (const el of candidates) {
                if (!el || el === root || el === document.body) continue;
                const style = window.getComputedStyle(el);
                const overflowY = style.overflowY;
                if (overflowY !== 'auto' && overflowY !== 'scroll' && overflowY !== 'overlay') continue;
                const delta = el.scrollHeight - el.clientHeight;
                if (delta < 300 || el.clientHeight < 220) continue;
                if (delta > bestDelta) {
                  bestDelta = delta;
                  bestElement = el;
                }
              }

              if (bestElement && bestDelta > windowDelta + 200) {
                const step = Math.max(120, bestElement.clientHeight * 0.85);
                const before = bestElement.scrollTop;
                const maxTop = Math.max(0, bestElement.scrollHeight - bestElement.clientHeight);
                bestElement.scrollTop = Math.min(maxTop, before + step);
                bestElement.dispatchEvent(new Event('scroll', { bubbles: true }));
                const after = bestElement.scrollTop;
                return { target: 'container', moved: after > before + 1, atEnd: maxTop - after < 2 };
              }

              const before = window.scrollY;
              window.scrollBy(0, Math.max(120, window.innerHeight * 0.9));
              window.dispatchEvent(new Event('scroll'));
              const rootAfter = (document.scrollingElement as HTMLElement | null) || document.documentElement;
              const maxY = Math.max(0, rootAfter.scrollHeight - window.innerHeight);
              const after = window.scrollY;
              return { target: 'window', moved: after > before + 1, atEnd: maxY - after < 2 };
            });
            pageScrollCount++;
            totalScrollCount++;
            const scrollTargetLabel = scrollStep.target === 'container' ? 'container' : 'page';

            send('status', { 
              message: maxPages > 1 
                ? `Page ${currentPageNum}: Scrolling ${scrollTargetLabel}... (${pageScrollCount}/${autoScrollUntilStable ? 'auto' : maxScrolls})` 
                : `Scrolling ${scrollTargetLabel}... (${pageScrollCount}/${autoScrollUntilStable ? 'auto' : maxScrolls})`, 
              scrollCount: totalScrollCount, 
              imageCount: totalMediaSent,
              pageNum: currentPageNum
            });

            await new Promise(resolve => setTimeout(resolve, scrollDelayMs));

            try {
              await page.waitForNetworkIdle({ timeout: 2000 });
            } catch {
              // Continue anyway
            }

            const prevSent = totalMediaSent;
            const newUrlCount = await extractAndSendNewImages();
            
            if (newUrlCount === 0) {
              noNewImagesCount++;
            } else {
              noNewImagesCount = 0;
            }

            if (totalMediaSent > prevSent) {
              send('status', { 
                message: `Found ${totalMediaSent - prevSent} new media assets`, 
                scrollCount: totalScrollCount, 
                imageCount: totalMediaSent,
                pageNum: currentPageNum
              });
            }
          }

          if (pageScrollCount >= maxScrolls && noNewImagesCount < NO_NEW_IMAGE_STOP_THRESHOLD) {
            stoppedByScrollCap = true;
          }

          // Check for next page (only if maxPages > 1)
          if (maxPages > 1 && currentPageNum < maxPages) {
            const nextUrl = await findNextPageUrl();
            if (nextUrl && !visitedPages.has(nextUrl)) {
              currentUrl = nextUrl;
              currentPageNum++;
              send('status', { 
                message: `Moving to page ${currentPageNum}...`, 
                scrollCount: totalScrollCount, 
                imageCount: totalMediaSent,
                pageNum: currentPageNum
              });
            } else {
              // No more pages
              break;
            }
          } else {
            break;
          }
        }

        const pageInfo = maxPages > 1 ? ` across ${currentPageNum} page${currentPageNum !== 1 ? 's' : ''}` : '';
        const stopReason = stoppedByScrollCap
          ? (autoScrollUntilStable
              ? `Reached auto-scroll safety cap (${maxScrolls} scrolls)`
              : `Reached max scrolls (${maxScrolls})`)
          : `Stopped after ${NO_NEW_IMAGE_STOP_THRESHOLD} rounds with no new images`;

        if (sawProdPage403 && sawProtectionPayload && totalMediaSent === 0) {
          send('error', {
            error:
              'This page appears to block automated product scraping (McMaster protection response). Open the page in your browser and import direct image URLs, or use an authenticated scraping workflow.',
            details: { protectionMode: true },
          });
          return;
        }
        send('done', { 
          scrollCount: totalScrollCount,
          pageCount: currentPageNum,
          imageCount: totalMediaSent,
          message: `Completed${pageInfo} with ${totalScrollCount} scrolls (${stopReason})`
        });

      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        send('error', { error: `Browser error: ${message}` });
      } finally {
        if (browser) {
          await browser.close();
        }
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
