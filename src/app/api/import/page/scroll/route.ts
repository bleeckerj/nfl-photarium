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
 * - IMPORT_SCROLL_TIMEOUT_MS: Page load timeout (default: 30000)
 */

import { NextRequest, NextResponse } from 'next/server';

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

const DEFAULT_MIN_BYTES = 8 * 1024;
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
}

interface ImageInfo {
  url: string;
  filename: string;
  naturalWidth?: number;
  naturalHeight?: number;
}

/**
 * Extract all image URLs from the page after scrolling
 */
const extractImagesFromPage = async (
  pageUrl: string,
  options: ScrollOptions
): Promise<{ images: ImageInfo[]; scrollCount: number; error?: string }> => {
  const pup = await loadPuppeteer();
  if (!pup) {
    return { images: [], scrollCount: 0, error: 'Puppeteer not installed. Run: npm install puppeteer' };
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
    
    // Set a reasonable user agent
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // Navigate to the page
    await page.goto(pageUrl, {
      waitUntil: 'networkidle2',
      timeout: options.timeoutMs,
    });

    // Initial wait for dynamic content
    await new Promise(resolve => setTimeout(resolve, 1000));

    let scrollCount = 0;
    let previousImageCount = 0;
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

      previousImageCount = seenUrls.size;

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
    const allImages = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      const sources = Array.from(document.querySelectorAll('source'));
      
      const results: Array<{
        src: string;
        srcset: string;
        dataSrc: string;
        naturalWidth: number;
        naturalHeight: number;
      }> = [];

      for (const img of imgs) {
        results.push({
          src: img.src || '',
          srcset: img.srcset || '',
          dataSrc: img.dataset.src || img.dataset.lazySrc || img.dataset.original || '',
          naturalWidth: img.naturalWidth || 0,
          naturalHeight: img.naturalHeight || 0,
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
          });
        }
      }

      return results;
    });

    // Process and dedupe
    const imageMap = new Map<string, ImageInfo>();
    
    for (const img of allImages) {
      // Prefer srcset's largest image over src (src often has a smaller placeholder)
      const srcsetUrl = pickBestFromSrcset(img.srcset);
      const url = srcsetUrl || img.src || img.dataSrc;
      if (!url) continue;
      
      try {
        const resolved = new URL(url, pageUrl);
        if (!['http:', 'https:'].includes(resolved.protocol)) continue;
        if (isPrivateHost(resolved.hostname)) continue;
        
        const cleanUrl = resolved.toString().split('#')[0]; // Remove hash
        
        if (!imageMap.has(cleanUrl)) {
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
      scrollCount,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { images: [], scrollCount: 0, error: `Browser error: ${message}` };
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
    const minBytes = Number.isFinite(body?.minBytes) ? Number(body.minBytes) : SCROLL_MODE_MIN_BYTES;
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

    const { images, scrollCount, error } = await extractImagesFromPage(pageUrl, {
      maxScrolls,
      scrollDelayMs,
      timeoutMs: Number(process.env.IMPORT_SCROLL_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
      viewport: { width: 1280, height: 900 },
    });

    if (error) {
      return NextResponse.json({ error }, { status: 500 });
    }

    console.log(`[import/page/scroll] Found ${images.length} images after ${scrollCount} scrolls`);

    // For scroll mode, we trust Puppeteer found real images in the DOM
    // Skip HEAD requests entirely - they're slow and unreliable (CDNs block them, return wrong sizes, etc.)
    // Filter by: domain blocklist, file extension, and naturalWidth/naturalHeight
    const MIN_DIMENSION = 50; // Filter out tiny icons/tracking pixels
    
    // Known tracking/ad pixel domains to exclude
    const BLOCKED_DOMAINS = [
      'adroll.com', 'd.adroll.com',
      'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
      'facebook.com', 'facebook.net', 'fbcdn.net',
      'analytics.', 'pixel.', 'tracking.',
      'ads.', 'ad.', 'beacon.',
      'criteo.com', 'taboola.com', 'outbrain.com',
    ];
    
    const isBlockedDomain = (url: string) => {
      try {
        const hostname = new URL(url).hostname.toLowerCase();
        return BLOCKED_DOMAINS.some(blocked => 
          hostname === blocked || hostname.endsWith('.' + blocked) || hostname.includes(blocked)
        );
      } catch {
        return false;
      }
    };
    
    // Check if URL looks like a real image (not a tracking pixel endpoint)
    const looksLikeImage = (url: string) => {
      const path = new URL(url).pathname.toLowerCase();
      // Has a real image extension
      if (/\.(jpg|jpeg|png|gif|webp|avif|svg|bmp|ico)(\?|$)/i.test(path)) {
        return true;
      }
      // Or is from a known CDN pattern
      if (url.includes('/cdn/') || url.includes('/images/') || url.includes('/media/')) {
        return true;
      }
      return false;
    };
    
    const filteredImages = images.filter(img => {
      // Filter out tracking/ad domains
      if (isBlockedDomain(img.url)) {
        return false;
      }
      
      // If we got naturalWidth/naturalHeight from the browser, use that to filter tiny images
      if (img.naturalWidth && img.naturalHeight) {
        if (img.naturalWidth < MIN_DIMENSION && img.naturalHeight < MIN_DIMENSION) {
          return false;
        }
        // Has valid dimensions, keep it
        return true;
      }
      
      // No dimensions - only keep if URL looks like a real image
      return looksLikeImage(img.url);
    });
    
    // Apply maxImages limit if specified
    const limitedImages = typeof maxImages === 'number' && maxImages > 0
      ? filteredImages.slice(0, maxImages)
      : filteredImages;

    console.log(`[import/page/scroll] Returning ${limitedImages.length} images (filtered ${images.length - filteredImages.length} non-content images)`);

    return NextResponse.json({
      sourceUrl: pageUrl,
      minBytes,
      maxImages: typeof maxImages === 'number' ? maxImages : null,
      scrollCount,
      mode: 'scroll',
      images: limitedImages.map(img => ({
        url: img.url,
        filename: img.filename,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
      })),
    });
  } catch (error) {
    console.error('Scroll import error:', error);
    return NextResponse.json({ error: 'Failed to scan page with scrolling' }, { status: 500 });
  }
}
