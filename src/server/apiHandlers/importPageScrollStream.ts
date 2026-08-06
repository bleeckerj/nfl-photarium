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
  looksLikeTinyTrackingPixel,
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
  resolveSmallAssetReviewForImage,
  serializeMediaCandidate,
  shouldIncludeImageWithOptions,
  type ImageInfo,
  type MediaInfo,
} from '@/server/page-import/scrollMediaCandidates';
import { loadPuppeteer } from '@/server/page-import/scrollPuppeteer';
import { parseScrollImportRequest } from '@/server/page-import/scrollRequest';
import {
  extractScrollStreamMediaElements,
  findScrollStreamNextPageUrl,
  scrollStreamPageStep,
  triggerScrollLazyLoad,
} from '@/server/page-import/scrollStreamDom';
import {
  createScrollStreamNetworkState,
  registerScrollStreamNetworkCapture,
} from '@/server/page-import/scrollStreamNetwork';
const NO_NEW_IMAGE_STOP_THRESHOLD = 3;
type LoadedPuppeteer = NonNullable<Awaited<ReturnType<typeof loadPuppeteer>>>;
type ScrollStreamBrowser = Awaited<ReturnType<LoadedPuppeteer['launch']>>;

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsedRequest = parseScrollImportRequest(body);
  if ('response' in parsedRequest) return parsedRequest.response;
  const {
    pageUrl,
    includeUiChrome,
    includeSmallAssets,
    smallAssetThresholdBytes,
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

      let browser: ScrollStreamBrowser | undefined;
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
        const networkState = createScrollStreamNetworkState();
        let totalScrollCount = 0;
        let currentPageNum = 1;
        let currentUrl = pageUrl;
        const visitedPages = new Set<string>();
        let stoppedByScrollCap = false;
        const targetHost = new URL(pageUrl).hostname.toLowerCase();
        const isMcMasterHost = targetHost === 'mcmaster.com' || targetHost.endsWith('.mcmaster.com');
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

        registerScrollStreamNetworkCapture(page, networkState, {
          pageUrl,
          includeUiChrome,
          isMcMasterHost,
        });

        // Helper to extract and process media (images + videos)
        const extractAndSendNewImages = async () => {
          if (shouldStop()) return 0;
          const pageLocation = await page.evaluate(() => window.location.href);
          if (shouldStop()) return 0;
          const allMedia = await extractScrollStreamMediaElements(page);

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

              if (mediaInfo.kind === 'image') {
                mediaInfo.smallAssetReview = resolveSmallAssetReviewForImage(
                  mediaInfo,
                  smallAssetThresholdBytes
                );
              }

              if (
                mediaInfo.kind === 'image' &&
                !shouldIncludeImageWithOptions(mediaInfo, {
                  includeUiChrome,
                  includeSmallAssets,
                  smallAssetThresholdBytes,
                })
              ) {
                seenMedia.add(dedupeKey);
                continue;
              }
              if (
                mediaInfo.kind === 'image' &&
                networkState.sawProdPage403 &&
                networkState.sawProtectionPayload &&
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

          for (const [networkUrl, metadata] of networkState.imageCandidates.entries()) {
            if (shouldStop()) break;
            const dedupeKey = `image:${networkUrl}`;
            if (seenMedia.has(dedupeKey)) continue;

            const mediaInfo: ImageInfo = {
              kind: 'image',
              url: networkUrl,
              filename: getFilenameFromUrl(networkUrl),
              contentLength: metadata.contentLength,
            };
            mediaInfo.smallAssetReview = resolveSmallAssetReviewForImage(
              mediaInfo,
              smallAssetThresholdBytes
            );

            if (looksLikeTinyTrackingPixel({
              url: mediaInfo.url,
              filenameHint: mediaInfo.filename,
              contentLength: mediaInfo.contentLength,
            })) {
              seenMedia.add(dedupeKey);
              continue;
            }
            if (
              !metadata.trusted &&
              !shouldIncludeImageWithOptions(mediaInfo, {
                includeUiChrome,
                includeSmallAssets,
                smallAssetThresholdBytes,
              })
            ) {
              seenMedia.add(dedupeKey);
              continue;
            }
            if (
              networkState.sawProdPage403 &&
              networkState.sawProtectionPayload &&
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
          await triggerScrollLazyLoad(page);
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
            const scrollStep = await scrollStreamPageStep(page);
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
            const nextUrl = await findScrollStreamNextPageUrl(page);
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

        if (networkState.sawProdPage403 && networkState.sawProtectionPayload && totalMediaSent === 0) {
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

