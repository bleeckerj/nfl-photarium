import {
  buildArchiveChallengeMessage,
  inspectArchiveText,
  isArchiveHost,
  logArchiveDiagnostics,
  type ArchiveDiagnostics,
} from '@/server/archiveDiagnostics';
import {
  cookieHeaderToPuppeteerCookies,
} from '@/server/pageImportCookies';
import {
  navigatePageForImport,
  waitForPageImportNetworkIdle,
} from '@/server/pageImportBrowserNavigation';
import {
  getFilenameFromUrl,
  isPrivateHost,
  pickBestFromSrcset,
  type ImageInfo,
  type VideoInfo,
} from '@/server/page-import/scrollMediaCandidates';

// Puppeteer is optional in this project; route code asks this loader so tests can
// inject a fake browser without forcing the dependency into every environment.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let puppeteer: any = null;

const getPuppeteerTestOverride = () =>
  (globalThis as typeof globalThis & { __PHOTARIUM_TEST_PUPPETEER__?: unknown })
    .__PHOTARIUM_TEST_PUPPETEER__;

export const loadPuppeteer = async () => {
  const override = getPuppeteerTestOverride();
  if (override) return override;
  if (puppeteer) return puppeteer;
  try {
    puppeteer = await (Function('return import("puppeteer")')());
    return puppeteer;
  } catch {
    return null;
  }
};

export interface ScrollExtractOptions {
  maxScrolls: number;
  scrollDelayMs: number;
  timeoutMs: number;
  viewport: { width: number; height: number };
  cookieHeader?: string | null;
}

export interface ScrollExtractResult {
  images: ImageInfo[];
  videos: VideoInfo[];
  scrollCount: number;
  protectionMode: boolean;
  archiveDiagnostics?: ArchiveDiagnostics | null;
  error?: string;
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

export const extractMediaFromPage = async (
  pageUrl: string,
  options: ScrollExtractOptions
): Promise<ScrollExtractResult> => {
  const pup = await loadPuppeteer();
  if (!pup) {
    return {
      images: [],
      videos: [],
      scrollCount: 0,
      protectionMode: false,
      error: 'Puppeteer not installed. Run: npm install puppeteer',
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

    const navigation = await navigatePageForImport(page, pageUrl, {
      timeoutMs: options.timeoutMs,
    });
    await waitForPageImportNetworkIdle(page);
    await new Promise((resolve) => setTimeout(resolve, 1000));

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

    while (scrollCount < options.maxScrolls && noNewImagesCount < 3) {
      const currentImages = await page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll('img'));
        return imgs.map((img) => ({
          src: img.src || img.dataset.src || img.dataset.lazySrc || '',
          srcset: img.srcset || '',
        }));
      });

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

      await page.evaluate(() => {
        window.scrollBy(0, window.innerHeight);
      });

      scrollCount++;
      await new Promise((resolve) => setTimeout(resolve, options.scrollDelayMs));

      try {
        await page.waitForNetworkIdle({ timeout: 2000 });
      } catch {
        // Continue when normal page traffic prevents a full network idle.
      }
    }

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

    const imageMap = new Map<string, ImageInfo>();
    const videoMap = new Map<string, VideoInfo>();

    for (const img of allMedia) {
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

        const cleanUrl = resolved.toString().split('#')[0];

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
            kind: 'image',
            url: cleanUrl,
            filename: getFilenameFromUrl(cleanUrl),
            naturalWidth: img.naturalWidth || undefined,
            naturalHeight: img.naturalHeight || undefined,
          });
        }
      } catch {
        // Invalid URL, skip.
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
    return {
      images: [],
      videos: [],
      scrollCount: 0,
      protectionMode: false,
      archiveDiagnostics: null,
      error: `Browser error: ${message}`,
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
};
