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
const DEFAULT_SCROLL_DELAY_MS = 1500;
const DEFAULT_TIMEOUT_MS = 30000;

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

interface ImageInfo {
  url: string;
  filename: string;
  naturalWidth?: number;
  naturalHeight?: number;
}

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

const looksLikeImage = (url: string) => {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (/\.(jpg|jpeg|png|gif|webp|avif|svg|bmp|ico)(\?|$)/i.test(path)) {
      return true;
    }
    if (url.includes('/cdn/') || url.includes('/images/') || url.includes('/media/')) {
      return true;
    }
  } catch {
    // ignore
  }
  return false;
};

const MIN_DIMENSION = 50;

// Check if URL contains size hints suggesting it's a real image
const urlHasSizeHints = (url: string): boolean => {
  // Match patterns like 800x800, 300w, @2x, etc. indicating real image dimensions
  return /(\d{2,}x\d{2,})|(_\d{3,}w)|(@[23]x)/i.test(url);
};

const shouldIncludeImage = (img: ImageInfo): boolean => {
  if (isBlockedDomain(img.url)) return false;
  
  // If URL has size hints (like 800x800), trust it even if naturalWidth/Height are tiny
  // This handles lazy-loaded images where the actual image hasn't loaded yet
  if (urlHasSizeHints(img.url)) {
    return true;
  }
  
  if (img.naturalWidth && img.naturalHeight) {
    if (img.naturalWidth < MIN_DIMENSION && img.naturalHeight < MIN_DIMENSION) {
      return false;
    }
    return true;
  }
  
  return looksLikeImage(img.url);
};

export async function POST(request: NextRequest) {
  const body = await request.json();
  const pageUrl = typeof body?.url === 'string' ? body.url.trim() : '';
  const maxScrolls = Number.isFinite(body?.maxScrolls) 
    ? Math.max(1, Math.min(50, Number(body.maxScrolls))) 
    : Number(process.env.IMPORT_SCROLL_MAX_SCROLLS) || DEFAULT_MAX_SCROLLS;
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
        await page.setUserAgent(
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        );

        const seenUrls = new Set<string>();
        const sentImages = new Set<string>();
        let totalImagesSent = 0;
        let totalScrollCount = 0;
        let currentPageNum = 1;
        let currentUrl = pageUrl;
        const visitedPages = new Set<string>();

        // Helper to trigger all lazy-loaded images by scrolling through the page
        const triggerLazyLoad = async () => {
          await page.evaluate(async () => {
            // Scroll to bottom in chunks to trigger lazy loaders
            const scrollHeight = document.body.scrollHeight;
            const viewHeight = window.innerHeight;
            
            for (let y = 0; y < scrollHeight; y += viewHeight * 0.8) {
              window.scrollTo(0, y);
              await new Promise(r => setTimeout(r, 100));
            }
            
            // Scroll back to top
            window.scrollTo(0, 0);
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

        // Helper to extract and process images
        const extractAndSendNewImages = async () => {
          const pageLocation = await page.evaluate(() => window.location.href);
          const allImages = await page.evaluate(() => {
            const imgs = Array.from(document.querySelectorAll('img'));
            const sources = Array.from(document.querySelectorAll('source'));
            
            const results: Array<{
              src: string;
              srcset: string;
              dataSrcset: string;
              dataSrc: string;
              naturalWidth: number;
              naturalHeight: number;
            }> = [];

            for (const img of imgs) {
              results.push({
                src: img.src || '',
                srcset: img.srcset || '',
                dataSrcset: img.dataset.srcset || img.getAttribute('data-srcset') || '',
                dataSrc: img.dataset.src || img.dataset.lazySrc || img.dataset.original || img.getAttribute('data-lazy') || '',
                naturalWidth: img.naturalWidth || 0,
                naturalHeight: img.naturalHeight || 0,
              });
            }

            for (const source of sources) {
              results.push({
                src: '',
                srcset: source.srcset || '',
                dataSrcset: source.dataset?.srcset || source.getAttribute('data-srcset') || '',
                dataSrc: source.dataset?.src || '',
                naturalWidth: 0,
                naturalHeight: 0,
              });
            }

            return results;
          });

          let newCount = 0;
          
          for (const img of allImages) {
            // Prioritize data-srcset over srcset (lazy loaders put high-res versions there)
            // Then check srcset, then data-src, then src
            const srcsetUrl = pickBestFromSrcset(img.dataSrcset) || pickBestFromSrcset(img.srcset);
            const rawUrl = srcsetUrl || img.dataSrc || img.src;
            if (!rawUrl) continue;
            
            try {
              const resolved = new URL(rawUrl, pageLocation);
              if (!['http:', 'https:'].includes(resolved.protocol)) continue;
              if (isPrivateHost(resolved.hostname)) continue;
              
              const cleanUrl = resolved.href;
              
              if (seenUrls.has(cleanUrl)) continue;
              seenUrls.add(cleanUrl);
              newCount++;
              
              const imageInfo: ImageInfo = {
                url: cleanUrl,
                filename: getFilenameFromUrl(cleanUrl),
                naturalWidth: img.naturalWidth || undefined,
                naturalHeight: img.naturalHeight || undefined,
              };
              
              // Check if we should include this image
              if (!shouldIncludeImage(imageInfo)) continue;
              
              // Only send if not already sent
              if (!sentImages.has(cleanUrl)) {
                sentImages.add(cleanUrl);
                totalImagesSent++;
                send('image', imageInfo);
              }
            } catch {
              // Invalid URL, skip
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
            imageCount: totalImagesSent,
            pageNum: currentPageNum
          });

          await page.goto(currentUrl, {
            waitUntil: 'networkidle2',
            timeout: timeoutMs,
          });

          await new Promise(resolve => setTimeout(resolve, 1000));

          // Trigger lazy loading by scrolling through the page first
          send('status', { 
            message: maxPages > 1 ? `Triggering lazy load on page ${currentPageNum}...` : 'Triggering lazy load...', 
            scrollCount: totalScrollCount, 
            imageCount: totalImagesSent,
            pageNum: currentPageNum
          });
          await triggerLazyLoad();

          // Initial extraction for this page
          send('status', { 
            message: maxPages > 1 ? `Scanning page ${currentPageNum}...` : 'Scanning page...', 
            scrollCount: totalScrollCount, 
            imageCount: totalImagesSent,
            pageNum: currentPageNum
          });
          await extractAndSendNewImages();

          // Scroll within this page
          let pageScrollCount = 0;
          let noNewImagesCount = 0;
          
          while (pageScrollCount < maxScrolls && noNewImagesCount < 3) {
            await page.evaluate(() => {
              window.scrollBy(0, window.innerHeight);
            });
            pageScrollCount++;
            totalScrollCount++;

            send('status', { 
              message: maxPages > 1 
                ? `Page ${currentPageNum}: Scrolling... (${pageScrollCount}/${maxScrolls})` 
                : `Scrolling... (${pageScrollCount}/${maxScrolls})`, 
              scrollCount: totalScrollCount, 
              imageCount: totalImagesSent,
              pageNum: currentPageNum
            });

            await new Promise(resolve => setTimeout(resolve, scrollDelayMs));

            try {
              await page.waitForNetworkIdle({ timeout: 2000 });
            } catch {
              // Continue anyway
            }

            const prevSent = totalImagesSent;
            const newUrlCount = await extractAndSendNewImages();
            
            if (newUrlCount === 0) {
              noNewImagesCount++;
            } else {
              noNewImagesCount = 0;
            }

            if (totalImagesSent > prevSent) {
              send('status', { 
                message: `Found ${totalImagesSent - prevSent} new images`, 
                scrollCount: totalScrollCount, 
                imageCount: totalImagesSent,
                pageNum: currentPageNum
              });
            }
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
                imageCount: totalImagesSent,
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
        send('done', { 
          scrollCount: totalScrollCount,
          pageCount: currentPageNum,
          imageCount: totalImagesSent,
          message: `Completed${pageInfo} with ${totalScrollCount} scrolls`
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
