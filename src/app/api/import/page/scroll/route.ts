/**
 * Headless browser scrolling endpoint for infinite scroll pages.
 * 
 * This uses Puppeteer to:
 * 1. Load the page in a headless browser
 * 2. Scroll down to trigger lazy loading
 * 3. Wait for new images to appear
 * 4. Repeat until no new content or max scrolls reached
 * 5. Extract all image URLs
 * 
 * Requires: npm install puppeteer
 * 
 * Environment variables:
 * - PUPPETEER_EXECUTABLE_PATH: Path to Chrome/Chromium (optional, auto-detects)
 * - IMPORT_SCROLL_MAX_SCROLLS: Max number of scroll iterations (default: 10)
 * - IMPORT_SCROLL_TIMEOUT_MS: Initial DOM navigation timeout (default: 30000)
 */

import { NextRequest, NextResponse } from 'next/server';
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
  type ArchiveDiagnostics,
} from '@/server/archiveDiagnostics';
import {
  cookieHeaderToPuppeteerCookies,
  normalizeCookieHeader,
} from '@/server/pageImportCookies';
import {
  navigatePageForImport,
  waitForPageImportNetworkIdle,
} from '@/server/pageImportBrowserNavigation';
import { toImportCandidate } from '@/server/import-metadata/candidates';

// Puppeteer types - we use any since it's an optional dependency
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let puppeteer: any = null;

const loadPuppeteer = async () => {
  if (puppeteer) return puppeteer;
  try {
    // Dynamic import - TypeScript doesn't need to resolve this at compile time
    puppeteer = await (Function('return import("puppeteer")')());
    return puppeteer;
  } catch {
    return null;
  }
};

const DEFAULT_MAX_SCROLLS = 10;
const DEFAULT_SCROLL_DELAY_MS = 1500;
const DEFAULT_TIMEOUT_MS = 30000;
// For scroll mode, we trust puppeteer found real images, so use a very low threshold
const SCROLL_MODE_MIN_BYTES = 1024; // 1KB - just filter out tiny tracking pixels

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

interface ScrollOptions {
  maxScrolls: number;
  scrollDelayMs: number;
  timeoutMs: number;
  viewport: { width: number; height: number };
  cookieHeader?: string | null;
}

const getArchivePageDiagnostics = async (
  pageUrl: string,
  page: {
    title: () => Promise<string>;
    evaluate: <T>(pageFunction: () => T | Promise<T>) => Promise<T>;
    url: () => string;
  },
  status?: number
): Promise<ArchiveDiagnostics | null> => {
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
  url: string;
  filename: string;
  naturalWidth?: number;
  naturalHeight?: number;
}

interface VideoInfo {
  kind: 'video';
  url: string;
  filename: string;
  posterUrl?: string;
  isBlob: boolean;
}

/**
 * Extract all image URLs from the page after scrolling
 */
const extractMediaFromPage = async (
  pageUrl: string,
  options: ScrollOptions
): Promise<{
  images: ImageInfo[];
  videos: VideoInfo[];
  scrollCount: number;
  protectionMode: boolean;
  archiveDiagnostics?: ArchiveDiagnostics | null;
  error?: string;
}> => {
  const pup = await loadPuppeteer();
  if (!pup) {
    return {
      images: [],
      videos: [],
      scrollCount: 0,
      protectionMode: false,
      error: 'Puppeteer not installed. Run: npm install puppeteer'
    };
  }

  let browser;
  try {
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
    await page.setViewport(options.viewport);
    if (options.cookieHeader) {
      const cookies = cookieHeaderToPuppeteerCookies(pageUrl, options.cookieHeader);
      if (cookies.length > 0) {
        await page.setCookie(...cookies);
      }
    }
    
    // Set a reasonable user agent
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    const targetHost = new URL(pageUrl).hostname.toLowerCase();
    const isMcMasterHost = targetHost === 'mcmaster.com' || targetHost.endsWith('.mcmaster.com');
    let sawProdPage403 = false;
    let sawProtectionPayload = false;
    page.on('response', (response: { url: () => string; status: () => number }) => {
      const responseUrl = response.url();
      if (!isMcMasterHost) return;
      if (responseUrl.includes('ProdPageWebPart.aspx') && response.status() === 403) {
        sawProdPage403 = true;
      }
      if (responseUrl.includes('prodDatProtection.aspx') && response.status() === 200) {
        sawProtectionPayload = true;
      }
    });

    // Network idle is best-effort because normal pages can keep requests open.
    const navigation = await navigatePageForImport(page, pageUrl, {
      timeoutMs: options.timeoutMs,
    });
    await waitForPageImportNetworkIdle(page);

    // Initial wait for dynamic content
    await new Promise(resolve => setTimeout(resolve, 1000));
    const archiveDiagnostics = await getArchivePageDiagnostics(pageUrl, page, navigation.response?.status?.());
    logArchiveDiagnostics('import/page/scroll', archiveDiagnostics, { phase: 'page-load' });
    if (archiveDiagnostics?.challengeDetected) {
      return {
        images: [],
        videos: [],
        scrollCount: 0,
        protectionMode: false,
        archiveDiagnostics,
        error: buildArchiveChallengeMessage(archiveDiagnostics.host),
      };
    }

    let scrollCount = 0;
    let noNewImagesCount = 0;
    const seenUrls = new Set<string>();

    // Scroll and collect images
    while (scrollCount < options.maxScrolls && noNewImagesCount < 3) {
      // Get current image count
      const currentImages = await page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll('img'));
        return imgs.map(img => ({
          src: img.src || img.dataset.src || img.dataset.lazySrc || '',
          srcset: img.srcset || '',
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
        }));
      });

      // Count unique URLs we haven't seen
      let newUrlCount = 0;
      for (const img of currentImages) {
        const url = img.src || pickBestFromSrcset(img.srcset);
        if (url && !seenUrls.has(url)) {
          seenUrls.add(url);
          newUrlCount++;
        }
      }

      if (newUrlCount === 0 && scrollCount > 0) {
        noNewImagesCount++;
      } else {
        noNewImagesCount = 0;
      }

      // Scroll down
      await page.evaluate(() => {
        window.scrollBy(0, window.innerHeight);
      });

      scrollCount++;

      // Wait for potential lazy-loaded content
      await new Promise(resolve => setTimeout(resolve, options.scrollDelayMs));

      // Also wait for network to settle
      try {
        await page.waitForNetworkIdle({ timeout: 2000 });
      } catch {
        // Network didn't fully idle, continue anyway
      }
    }

    // Final extraction of all images
    const allMedia = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      const sources = Array.from(document.querySelectorAll('source'));
      const videos = Array.from(document.querySelectorAll('video'));
      
      const results: Array<{
        src: string;
        srcset: string;
        dataSrc: string;
        naturalWidth: number;
        naturalHeight: number;
        mediaKind: 'image' | 'video';
        poster: string;
      }> = [];

      for (const img of imgs) {
        results.push({
          src: img.src || '',
          srcset: img.srcset || '',
          dataSrc: img.dataset.src || img.dataset.lazySrc || img.dataset.original || '',
          naturalWidth: img.naturalWidth || 0,
          naturalHeight: img.naturalHeight || 0,
          mediaKind: 'image',
          poster: '',
        });
      }

      for (const source of sources) {
        if (source.srcset) {
          results.push({
            src: '',
            srcset: source.srcset,
            dataSrc: '',
            naturalWidth: 0,
            naturalHeight: 0,
            mediaKind: 'image',
            poster: '',
          });
        }
      }

      for (const video of videos) {
        const source = video.querySelector('source');
        const src = video.currentSrc || video.src || source?.src || '';
        const filenameHint = video.getAttribute('aria-label') || video.getAttribute('title') || '';
        results.push({
          src,
          srcset: '',
          dataSrc: filenameHint,
          naturalWidth: video.videoWidth || 0,
          naturalHeight: video.videoHeight || 0,
          mediaKind: 'video',
          poster: video.poster || '',
        });
      }

      return results;
    });

    // Process and dedupe
    const imageMap = new Map<string, ImageInfo>();
    const videoMap = new Map<string, VideoInfo>();
    
    for (const img of allMedia) {
      // Prefer srcset's largest image over src (src often has a smaller placeholder)
      const srcsetUrl = pickBestFromSrcset(img.srcset);
      const url = srcsetUrl || img.src || img.dataSrc;
      if (!url) continue;
      
      try {
        const resolved = new URL(url, pageUrl);
        const isBlob = resolved.protocol === 'blob:';
        if (!isBlob) {
          if (!['http:', 'https:'].includes(resolved.protocol)) continue;
          if (isPrivateHost(resolved.hostname)) continue;
        }
        
        const cleanUrl = resolved.toString().split('#')[0]; // Remove hash

        if (img.mediaKind === 'video') {
          if (!videoMap.has(cleanUrl)) {
            let posterUrl: string | undefined;
            if (img.poster) {
              try {
                posterUrl = new URL(img.poster, pageUrl).toString();
              } catch {
                posterUrl = undefined;
              }
            }
            videoMap.set(cleanUrl, {
              kind: 'video',
              url: cleanUrl,
              filename: getFilenameFromUrl(img.dataSrc || cleanUrl),
              posterUrl,
              isBlob,
            });
          }
        } else if (!imageMap.has(cleanUrl)) {
          imageMap.set(cleanUrl, {
            url: cleanUrl,
            filename: getFilenameFromUrl(cleanUrl),
            naturalWidth: img.naturalWidth || undefined,
            naturalHeight: img.naturalHeight || undefined,
          });
        }
      } catch {
        // Invalid URL, skip
      }
    }

    return {
      images: Array.from(imageMap.values()),
      videos: Array.from(videoMap.values()),
      scrollCount,
      protectionMode: sawProdPage403 && sawProtectionPayload,
      archiveDiagnostics,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { images: [], videos: [], scrollCount: 0, protectionMode: false, archiveDiagnostics: null, error: `Browser error: ${message}` };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
};

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
    // Decode and clean up
    return decodeURIComponent(filename).replace(/[?#].*$/, '');
  } catch {
    return 'remote-image';
  }
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const pageUrl = typeof body?.url === 'string' ? body.url.trim() : '';
    const includeUiChrome = Boolean(body?.includeUiChrome);
    const includeSmallAssets = Boolean(body?.includeSmallAssets);
    let cookieHeader: string | null = null;
    try {
      cookieHeader = normalizeCookieHeader(body?.cookieHeader);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid cookie header' }, { status: 400 });
    }
    const minBytes = Number.isFinite(body?.minBytes)
      ? Number(body.minBytes)
      : (includeSmallAssets ? 1024 : SCROLL_MODE_MIN_BYTES);
    const maxImages = Number.isFinite(body?.maxImages) ? Math.max(0, Number(body.maxImages)) : undefined;
    const maxScrolls = Number.isFinite(body?.maxScrolls) 
      ? Math.max(1, Math.min(50, Number(body.maxScrolls))) 
      : Number(process.env.IMPORT_SCROLL_MAX_SCROLLS) || DEFAULT_MAX_SCROLLS;
    const scrollDelayMs = Number.isFinite(body?.scrollDelayMs)
      ? Math.max(500, Math.min(5000, Number(body.scrollDelayMs)))
      : DEFAULT_SCROLL_DELAY_MS;

    if (!pageUrl || !isValidUrl(pageUrl)) {
      return NextResponse.json({ error: 'A valid page URL is required' }, { status: 400 });
    }

    const parsed = new URL(pageUrl);
    if (isPrivateHost(parsed.hostname)) {
      return NextResponse.json({ error: 'Private or localhost URLs are not allowed' }, { status: 400 });
    }

    console.log(`[import/page/scroll] Starting headless scroll for: ${pageUrl}`);
    console.log(`[import/page/scroll] maxScrolls=${maxScrolls}, scrollDelayMs=${scrollDelayMs}`);

    const { images, videos, scrollCount, protectionMode, archiveDiagnostics, error } = await extractMediaFromPage(pageUrl, {
      maxScrolls,
      scrollDelayMs,
      timeoutMs: Number(process.env.IMPORT_SCROLL_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
      viewport: { width: 1280, height: 900 },
      cookieHeader,
    });

    if (error) {
      return NextResponse.json(
        { error, details: archiveDiagnostics ? { archiveDiagnostics } : undefined },
        { status: archiveDiagnostics?.challengeDetected ? 403 : 500 }
      );
    }

    console.log(`[import/page/scroll] Found ${images.length} images and ${videos.length} videos after ${scrollCount} scrolls`);

    // For scroll mode, we trust Puppeteer found real images in the DOM
    // Skip HEAD requests entirely - they're slow and unreliable (CDNs block them, return wrong sizes, etc.)
    // Filter by: domain blocklist, file extension, and naturalWidth/naturalHeight
    const MIN_DIMENSION = 50; // Filter out tiny icons/tracking pixels
    
    const filteredImages = images.filter(img => {
      // McMaster can return a protected shell to automation.
      // In that mode, only allow product image-cache assets.
      if (protectionMode) {
        return /\/contents\/gfx\/imagecache\//i.test(img.url);
      }

      // Filter out tracking/ad domains
      if (isBlockedMediaDomain(img.url)) {
        return false;
      }

      // Filter out likely UI chrome (logos/icons/sprites/nav assets)
      if (!includeUiChrome && looksLikeUiChromeAsset(img.url, img.filename)) {
        return false;
      }
      if (looksLikeTrackingOrUtilityAsset(img.url, img.filename)) {
        return false;
      }
      if (looksLikeTinyTrackingPixel({
        url: img.url,
        filenameHint: img.filename,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
      })) {
        return false;
      }
      
      // If we got naturalWidth/naturalHeight from the browser, use that to filter tiny images
      if (img.naturalWidth && img.naturalHeight) {
        if (!includeSmallAssets && img.naturalWidth < MIN_DIMENSION && img.naturalHeight < MIN_DIMENSION) {
          return false;
        }
        // Has valid dimensions, keep it
        return true;
      }
      
      // No dimensions - only keep if URL looks like a real image
      return looksLikeImageAssetUrl(img.url);
    });

    if (protectionMode && filteredImages.length === 0) {
      return NextResponse.json(
        {
          error:
            'This page appears to block automated product scraping (McMaster protection response). Open the page in your browser and import direct image URLs, or use an authenticated scraping workflow.',
          details: { protectionMode: true },
        },
        { status: 403 }
      );
    }
    
    // Apply maxImages limit if specified
    const limitedImages = typeof maxImages === 'number' && maxImages > 0
      ? filteredImages.slice(0, maxImages)
      : filteredImages;
    const limitedVideos = typeof maxImages === 'number' && maxImages > 0
      ? videos.slice(0, maxImages)
      : videos;

    console.log(`[import/page/scroll] Returning ${limitedImages.length} images and ${limitedVideos.length} videos`);

    const normalizedImages = limitedImages.map((img) => {
      const candidate = toImportCandidate({
        kind: 'image',
        url: img.url,
        filename: img.filename,
        metadata: {
          dimensions:
            img.naturalWidth && img.naturalHeight
              ? { width: img.naturalWidth, height: img.naturalHeight }
              : undefined,
          sources: {
            dimensions:
              img.naturalWidth && img.naturalHeight ? 'browser' : undefined,
          },
        },
      });
      return {
        ...candidate,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
      };
    });

    const normalizedVideos = limitedVideos.map((video) => {
      const candidate = toImportCandidate({
        kind: 'video',
        url: video.url,
        filename: video.filename,
        previewUrl: video.posterUrl,
        posterUrl: video.posterUrl,
        isBlobSource: video.isBlob,
        metadata: {
          contentType: undefined,
        },
      });
      return {
        ...candidate,
        isBlob: video.isBlob,
      };
    });

    return NextResponse.json({
      sourceUrl: pageUrl,
      minBytes,
      maxImages: typeof maxImages === 'number' ? maxImages : null,
      includeUiChrome,
      includeSmallAssets,
      scrollCount,
      mode: 'scroll',
      archiveDiagnostics,
      images: normalizedImages,
      videos: normalizedVideos,
      media: [...normalizedImages, ...normalizedVideos],
    });
  } catch (error) {
    console.error('Scroll import error:', error);
    return NextResponse.json({ error: 'Failed to scan page with scrolling' }, { status: 500 });
  }
}
