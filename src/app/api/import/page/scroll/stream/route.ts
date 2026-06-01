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
  logArchiveDiagnostics,
} from '@/server/archiveDiagnostics';
import {
  cookieHeaderToPuppeteerCookies,
} from '@/server/pageImportCookies';
import {
  navigatePageForImport,
  waitForPageImportNetworkIdle,
} from '@/server/pageImportBrowserNavigation';
import { getArchivePageDiagnostics } from '@/server/page-import/scrollArchiveDiagnostics';
import {
  getFilenameFromUrl,
  inferVideoFileName,
  pickBestFromSrcset,
  resolveCandidateUrl,
  serializeMediaCandidate,
  shouldIncludeImageWithOptions,
  type ImageInfo,
  type MediaInfo,
} from '@/server/page-import/scrollMediaCandidates';
import { loadPuppeteer } from '@/server/page-import/scrollPuppeteer';
import { parseScrollImportRequest } from '@/server/page-import/scrollRequest';
const NO_NEW_IMAGE_STOP_THRESHOLD = 3;

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsedRequest = parseScrollImportRequest(body);
  if ('response' in parsedRequest) return parsedRequest.response;
  const {
    pageUrl,
    includeUiChrome,
    includeSmallAssets,
    cookieHeader,
    maxScrolls,
    autoScrollUntilStable,
    maxPages,
    maxAssets,
    scrollDelayMs,
    timeoutMs,
  } = parsedRequest.config;

  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (request.signal.aborted) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const pup = await loadPuppeteer();
      if (!pup) {
        send('error', { error: 'Puppeteer not installed. Run: npm install puppeteer' });
        controller.close();
        return;
      }

      let browser:
        | {
            close: () => Promise<void>;
            newPage: () => Promise<{
              evaluate: <T>(pageFunction: () => T | Promise<T>) => Promise<T>;
              goto: (url: string, options: { waitUntil: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2'; timeout: number }) => Promise<{ status?: () => number } | null>;
              on: (
                event: string,
                listener: (response: {
                  request: () => { resourceType?: () => string };
                  url: () => string;
                  headers: () => Record<string, string>;
                  status: () => number;
                }) => void
              ) => void;
              setCookie: (...cookies: unknown[]) => Promise<void>;
              setUserAgent: (userAgent: string) => Promise<void>;
              setViewport: (viewport: { width: number; height: number }) => Promise<void>;
              title: () => Promise<string>;
              url: () => string;
              waitForNetworkIdle: (options: { timeout: number }) => Promise<void>;
            }>;
          }
        | undefined;
      let stopReason: 'aborted' | 'max-assets' | null = null;
      let totalMediaSent = 0;
      const closeBrowser = async () => {
        if (!browser) return;
        const activeBrowser = browser;
        browser = undefined;
        await activeBrowser.close();
      };
      const handleAbort = () => {
        stopReason = 'aborted';
        void closeBrowser().catch(() => undefined);
      };
      request.signal.addEventListener('abort', handleAbort, { once: true });
      try {
        send('status', { message: 'Launching browser...', scrollCount: 0, imageCount: 0, pageNum: 1 });

        const launchedBrowser = await pup.launch({
          headless: true,
          executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-extensions',
          ],
        }) as NonNullable<typeof browser>;
        browser = launchedBrowser;

        const page = await launchedBrowser.newPage();
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
        let totalScrollCount = 0;
        let currentPageNum = 1;
        let currentUrl = pageUrl;
        const visitedPages = new Set<string>();
        let stoppedByScrollCap = false;
        const targetHost = new URL(pageUrl).hostname.toLowerCase();
        const isMcMasterHost = targetHost === 'mcmaster.com' || targetHost.endsWith('.mcmaster.com');
        let sawProdPage403 = false;
        let sawProtectionPayload = false;
        const shouldStop = () => {
          if (request.signal.aborted || stopReason === 'aborted') {
            stopReason = 'aborted';
            return true;
          }
          if (totalMediaSent >= maxAssets) {
            stopReason = 'max-assets';
            return true;
          }
          return false;
        };

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
          if (shouldStop()) return 0;
          const pageLocation = await page.evaluate(() => window.location.href);
          if (shouldStop()) return 0;
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
            if (shouldStop()) break;
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
                if (shouldStop()) break;
                sentMedia.add(dedupeKey);
                totalMediaSent++;
                const serialized = serializeMediaCandidate(mediaInfo);
                send('media', serialized);
                if (mediaInfo.kind === 'image') {
                  send('image', serialized);
                } else {
                  send('video', serialized);
                }
              }
            } catch {
              // Invalid URL, skip
            }
          }

          for (const [networkUrl, metadata] of networkImageCandidates.entries()) {
            if (shouldStop()) break;
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
              if (shouldStop()) break;
              sentMedia.add(dedupeKey);
              totalMediaSent++;
              const serialized = serializeMediaCandidate(mediaInfo);
              send('media', serialized);
              send('image', serialized);
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
          if (shouldStop()) break;
          visitedPages.add(currentUrl);
          
          send('status', { 
            message: maxPages > 1 ? `Loading page ${currentPageNum}...` : 'Loading page...', 
            scrollCount: totalScrollCount, 
            imageCount: totalMediaSent,
            pageNum: currentPageNum
          });

          const navigation = await navigatePageForImport(page, currentUrl, { timeoutMs });
          if (shouldStop()) break;
          await waitForPageImportNetworkIdle(page);
          if (shouldStop()) break;
          if (navigation.warning) {
            send('status', {
              message: navigation.warning,
              scrollCount: totalScrollCount,
              imageCount: totalMediaSent,
              pageNum: currentPageNum,
            });
          }

          await new Promise(resolve => setTimeout(resolve, 1000));
          if (shouldStop()) break;
          const archiveDiagnostics = await getArchivePageDiagnostics(currentUrl, page, navigation.response?.status?.());
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
          if (shouldStop()) break;

          // Initial extraction for this page
          send('status', { 
            message: maxPages > 1 ? `Scanning page ${currentPageNum}...` : 'Scanning page...', 
            scrollCount: totalScrollCount, 
            imageCount: totalMediaSent,
            pageNum: currentPageNum
          });
          await extractAndSendNewImages();
          if (shouldStop()) break;

          // Scroll within this page
          let pageScrollCount = 0;
          let noNewImagesCount = 0;
          
          while (pageScrollCount < maxScrolls && noNewImagesCount < NO_NEW_IMAGE_STOP_THRESHOLD) {
            if (shouldStop()) break;
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
            if (shouldStop()) break;
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
            if (shouldStop()) break;

            try {
              await page.waitForNetworkIdle({ timeout: 2000 });
            } catch {
              // Continue anyway
            }
            if (shouldStop()) break;

            const prevSent = totalMediaSent;
            const newUrlCount = await extractAndSendNewImages();
            if (shouldStop()) break;
            
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
          if (shouldStop()) break;

          // Check for next page (only if maxPages > 1)
          if (maxPages > 1 && currentPageNum < maxPages) {
            const nextUrl = await findNextPageUrl();
            if (shouldStop()) break;
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

        if (stopReason === 'aborted') {
          return;
        }

        const pageInfo = maxPages > 1 ? ` across ${currentPageNum} page${currentPageNum !== 1 ? 's' : ''}` : '';
        const completionReason = stopReason === 'max-assets'
          ? `Reached max assets (${maxAssets})`
          : stoppedByScrollCap
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
          message: `Completed${pageInfo} with ${totalScrollCount} scrolls (${completionReason})`
        });

      } catch (error) {
        if (request.signal.aborted || stopReason === 'aborted') {
          return;
        }
        const message = error instanceof Error ? error.message : 'Unknown error';
        send('error', { error: `Browser error: ${message}` });
      } finally {
        request.signal.removeEventListener('abort', handleAbort);
        await closeBrowser().catch(() => undefined);
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
