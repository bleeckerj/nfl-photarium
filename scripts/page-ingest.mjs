#!/usr/bin/env node

import fs from 'node:fs/promises';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';

const printUsage = () => {
  console.log(`
Usage:
  node scripts/page-ingest.mjs auth-help
  node scripts/page-ingest.mjs ingest [options]
  node scripts/page-ingest.mjs browser-ingest [options]

Options:
  --base-url <url>            API base URL (default: http://localhost:3000)
  --namespace <name>          Required upload namespace
  --url <page-url>            Page URL to scan (repeatable)
  --urls-file <path>          File containing one page URL per line
  --cookie-header <value>     Cookie header value (or full "Cookie: ...")
  --cookie-file <path>        File containing cookie header
  --mode <scroll|html>        Scan mode (default: scroll)
  --max-pages <n>             Scroll mode max pages (default: 1)
  --max-scrolls <n>           Scroll mode max scrolls (default: 10)
  --scroll-delay-ms <n>       Scroll mode delay between scrolls (default: 1500)
  --allow-insecure            Allow insecure TLS in scanner/uploader
  --folder <name>             Optional folder for uploaded images
  --tags <csv>                Optional CSV tags
  --description <text>        Optional description
  --dry-run                   Scan only; do not upload
  --include-regex <pattern>   Keep only URLs matching regex (browser-ingest)
  --no-prompt                 Browser-ingest: do not wait for Enter per page
  --wait-ms <n>               Browser-ingest no-prompt delay (default: 8000)
  --headless                  Browser-ingest in headless mode (default: headed)

Examples:
  npm run page:auth-help
  npm run page:ingest -- --namespace catalog --url https://example.com/products/1
  npm run page:ingest -- --namespace amazon --urls-file ./amazon-pages.txt --cookie-file ./cookie.txt --folder amazon
  npm run page:ingest -- browser-ingest --namespace catalog --url https://www.mcmaster.com/products/air-cleaners/fume-exhausters-1~/
`);
};

const normalizeCookieHeader = (raw) => {
  if (!raw) return '';
  const trimmed = String(raw).trim();
  if (!trimmed) return '';
  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const cookieLine = lines.find((line) => /^cookie\s*:/i.test(line));
  return (cookieLine || trimmed).replace(/^cookie\s*:\s*/i, '').trim();
};

const TRACKING_HOST_PATTERNS = [
  /(^|\.)amazon-adsystem\.com$/i,
  /(^|\.)experiment\.routing\.cloudfront\.aws\.a2z\.com$/i,
];

const TRACKING_PATH_OR_QUERY_PATTERNS = [
  /\/(?:webreports?|webreport|analytics?|tracking|tracker|metrics?|telemetry|beacon|pixel|collect|impression)(?:[\/_.-]|$)/i,
  /\/204(?:$|[/?#.])/i,
  /\/ecm\d*(?:$|[/?#.])/i,
  /\/x\.(?:png|gif|svg|webp|bmp|ico)(?:$|[?#])/i,
  /(?:^|[/?&])(?:pixel|beacon|tracking|analytics|webreport|event|impression)=/i,
  /(?:^|[/?&])(?:gdpr|gdpr_consent|cmp|consent_string)=/i,
];

const looksLikeTrackingUrl = (url) => {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const hostname = parsed.hostname.toLowerCase();
  if (TRACKING_HOST_PATTERNS.some((pattern) => pattern.test(hostname))) return true;
  const pathAndQuery = `${parsed.pathname.toLowerCase()}${parsed.search.toLowerCase()}`;
  return TRACKING_PATH_OR_QUERY_PATTERNS.some((pattern) => pattern.test(pathAndQuery));
};

const looksLikeTinyPixelByHints = (url) => {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const pathAndQuery = `${parsed.pathname.toLowerCase()}${parsed.search.toLowerCase()}`;
  const filename = parsed.pathname.split('/').filter(Boolean).pop() || '';
  const signal = `${pathAndQuery}/${filename.toLowerCase()}`;
  if (/(^|[\/_.-])(1x1|1x2|2x1|2x2|0x0|onebyone|spacer|blank|transparent|trackingpixel)([\/_.-]|$)/i.test(signal)) {
    return true;
  }
  return /(?:^|[?&])(?:w|width|h|height|imgw|imgh|sz|size)=(?:0|1|2|3|4)(?:[&#]|$)/i.test(pathAndQuery);
};

const parseArgs = (argv) => {
  const positional = [];
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const key = token.slice(2);
    if (key === 'allow-insecure' || key === 'dry-run' || key === 'headless' || key === 'no-prompt') {
      options[key] = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    i += 1;
    if (key === 'url') {
      if (!Array.isArray(options.url)) options.url = [];
      options.url.push(value);
    } else {
      options[key] = value;
    }
  }
  return { positional, options };
};

const readUrlsFromFile = async (filePath) => {
  const raw = await fs.readFile(filePath, 'utf8');
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
};

const toImageItems = (payload, pageUrl, namespace, overrides) => {
  const media = Array.isArray(payload?.media) ? payload.media : [];
  const fallbackImages = Array.isArray(payload?.images) ? payload.images.map((img) => ({ kind: 'image', ...img })) : [];
  const merged = media.length > 0 ? media : fallbackImages;
  const imageUrls = Array.from(
    new Set(
      merged
        .filter((entry) => entry && entry.kind === 'image' && typeof entry.url === 'string')
        .map((entry) => entry.url.trim())
        .filter((url) => /^https?:\/\//i.test(url))
    )
  );

  return imageUrls.map((url, index) => ({
    clientId: `${Date.now()}-${index + 1}`,
    url,
    namespace,
    folder: overrides.folder || undefined,
    tags: overrides.tags || undefined,
    description: overrides.description || undefined,
    sourceUrl: pageUrl,
    originalUrl: url,
  }));
};

const fetchJson = async (url, body) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();
  return { response, payload };
};

const runAuthHelp = () => {
  console.log(`
How to capture the Cookie request header:
1. Open the target site in your normal browser and sign in.
2. Open DevTools -> Network.
3. Refresh the page and click the main "document" request.
4. In Request Headers, copy the full Cookie header value.
5. Use it with:
   npm run page:ingest -- --namespace <ns> --urls-file pages.txt --cookie-header "cookie1=...; cookie2=..."
`);
};

const runIngest = async (options) => {
  const baseUrl = (options['base-url'] || 'http://localhost:3000').replace(/\/+$/, '');
  const namespace = (options.namespace || '').trim();
  if (!namespace || namespace === '__all__' || namespace === '__none__') {
    throw new Error('Provide a specific --namespace (not "__all__" or "__none__").');
  }

  const mode = options.mode === 'html' ? 'html' : 'scroll';
  const maxPages = Number(options['max-pages'] || 1);
  const maxScrolls = Number(options['max-scrolls'] || 10);
  const scrollDelayMs = Number(options['scroll-delay-ms'] || 1500);
  const allowInsecure = Boolean(options['allow-insecure']);
  const dryRun = Boolean(options['dry-run']);

  const cliUrls = Array.isArray(options.url) ? options.url : [];
  const fileUrls = options['urls-file'] ? await readUrlsFromFile(options['urls-file']) : [];
  const urls = Array.from(new Set([...cliUrls, ...fileUrls].map((item) => item.trim()).filter(Boolean)));
  if (urls.length === 0) {
    throw new Error('No URLs provided. Use --url and/or --urls-file.');
  }

  const cookieFromFile = options['cookie-file']
    ? normalizeCookieHeader(await fs.readFile(options['cookie-file'], 'utf8'))
    : '';
  const cookieHeader = normalizeCookieHeader(options['cookie-header'] || cookieFromFile);

  let totalScannedImages = 0;
  let totalUploaded = 0;
  let totalFailed = 0;

  for (const pageUrl of urls) {
    const scanEndpoint = mode === 'scroll' ? '/api/import/page/scroll' : '/api/import/page';
    const scanBody =
      mode === 'scroll'
        ? {
            url: pageUrl,
            maxPages,
            maxScrolls,
            scrollDelayMs,
            autoScrollUntilStable: false,
            allowInsecure,
            ...(cookieHeader ? { cookieHeader } : {}),
          }
        : {
            url: pageUrl,
            minBytes: 8 * 1024,
            allowInsecure,
            ...(cookieHeader ? { cookieHeader } : {}),
          };

    console.log(`\n[scan] ${pageUrl}`);
    const { response: scanResponse, payload: scanPayload } = await fetchJson(`${baseUrl}${scanEndpoint}`, scanBody);
    if (!scanResponse.ok) {
      const message =
        typeof scanPayload === 'object' && scanPayload && typeof scanPayload.error === 'string'
          ? scanPayload.error
          : `scan failed (${scanResponse.status})`;
      console.log(`  -> failed: ${message}`);
      totalFailed += 1;
      continue;
    }

    const items = toImageItems(scanPayload, pageUrl, namespace, {
      folder: options.folder,
      tags: options.tags,
      description: options.description,
    });
    totalScannedImages += items.length;
    console.log(`  -> found ${items.length} image URL(s)`);

    if (dryRun || items.length === 0) continue;

    const uploadBody = {
      items,
      allowInsecure,
      ...(cookieHeader ? { cookieHeader } : {}),
    };
    const { response: uploadResponse, payload: uploadPayload } = await fetchJson(
      `${baseUrl}/api/import/page/upload`,
      uploadBody
    );

    if (!uploadResponse.ok) {
      const message =
        typeof uploadPayload === 'object' && uploadPayload && typeof uploadPayload.error === 'string'
          ? uploadPayload.error
          : `upload failed (${uploadResponse.status})`;
      console.log(`  -> upload failed: ${message}`);
      totalFailed += items.length;
      continue;
    }

    const successCount = Number(uploadPayload?.successCount || 0);
    const failureCount = Number(uploadPayload?.failureCount || 0);
    totalUploaded += successCount;
    totalFailed += failureCount;
    console.log(`  -> uploaded ${successCount}, failed ${failureCount}`);
  }

  console.log('\nSummary');
  console.log(`- Pages processed: ${urls.length}`);
  console.log(`- Image URLs found: ${totalScannedImages}`);
  console.log(`- Uploaded: ${totalUploaded}`);
  console.log(`- Failed: ${totalFailed}`);
  if (dryRun) {
    console.log('- Dry run: no uploads were performed');
  }
};

const toUploadItemsFromUrls = (urls, pageUrl, namespace, overrides) =>
  urls.map((url, index) => ({
    clientId: `${Date.now()}-${index + 1}`,
    url,
    namespace,
    folder: overrides.folder || undefined,
    tags: overrides.tags || undefined,
    description: overrides.description || undefined,
    sourceUrl: pageUrl,
    originalUrl: url,
  }));

const runBrowserIngest = async (options) => {
  const baseUrl = (options['base-url'] || 'http://localhost:3000').replace(/\/+$/, '');
  const namespace = (options.namespace || '').trim();
  if (!namespace || namespace === '__all__' || namespace === '__none__') {
    throw new Error('Provide a specific --namespace (not "__all__" or "__none__").');
  }

  const cliUrls = Array.isArray(options.url) ? options.url : [];
  const fileUrls = options['urls-file'] ? await readUrlsFromFile(options['urls-file']) : [];
  const urls = Array.from(new Set([...cliUrls, ...fileUrls].map((item) => item.trim()).filter(Boolean)));
  if (urls.length === 0) {
    throw new Error('No URLs provided. Use --url and/or --urls-file.');
  }

  const allowInsecure = Boolean(options['allow-insecure']);
  const dryRun = Boolean(options['dry-run']);
  const includeRegex = options['include-regex'] ? new RegExp(String(options['include-regex']), 'i') : null;
  const noPrompt = Boolean(options['no-prompt']);
  const waitMs = Math.max(1000, Number(options['wait-ms'] || 8000));
  const headless = Boolean(options.headless);

  const puppeteer = await import('puppeteer');
  const browser = await puppeteer.default.launch({
    headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1365, height: 950 },
  });
  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  const rl = noPrompt ? null : createInterface({ input: process.stdin, output: process.stdout });
  let totalFound = 0;
  let totalUploaded = 0;
  let totalFailed = 0;

  try {
    for (const pageUrl of urls) {
      console.log(`\n[browser] ${pageUrl}`);
      await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 120000 });

      if (noPrompt) {
        console.log(`  waiting ${waitMs}ms for lazy content...`);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      } else if (rl) {
        const answer = (await rl.question('  complete login/captcha if needed, then press Enter to capture (s=skip, q=quit): '))
          .trim()
          .toLowerCase();
        if (answer === 'q') break;
        if (answer === 's') continue;
      }

      const extracted = await page.evaluate(() => {
        const pickBestFromSrcset = (srcset) => {
          if (!srcset) return '';
          const entries = srcset.split(',').map((part) => part.trim()).filter(Boolean);
          let bestUrl = '';
          let bestScore = -1;
          for (const entry of entries) {
            const [url, descriptor] = entry.split(/\s+/, 2);
            let score = 1;
            if (descriptor?.endsWith('w')) {
              const width = Number(descriptor.slice(0, -1));
              score = Number.isFinite(width) ? width : 0;
            } else if (descriptor?.endsWith('x')) {
              const ratio = Number(descriptor.slice(0, -1));
              score = Number.isFinite(ratio) ? ratio * 1000 : 0;
            }
            if (score > bestScore) {
              bestScore = score;
              bestUrl = url;
            }
          }
          return bestUrl;
        };

        const urls = new Set();
        const addUrl = (raw) => {
          if (!raw || typeof raw !== 'string') return;
          const trimmed = raw.trim();
          if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.startsWith('javascript:')) return;
          try {
            const resolved = new URL(trimmed, window.location.href);
            if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return;
            resolved.hash = '';
            urls.add(resolved.toString());
          } catch {
            // ignore invalid URLs
          }
        };

        document.querySelectorAll('img').forEach((img) => {
          addUrl(pickBestFromSrcset(img.srcset) || img.currentSrc || img.src || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original'));
        });
        document.querySelectorAll('source').forEach((source) => {
          addUrl(pickBestFromSrcset(source.srcset) || source.getAttribute('src') || source.getAttribute('data-src'));
        });
        document.querySelectorAll('*').forEach((el) => {
          const bg = window.getComputedStyle(el).backgroundImage;
          if (!bg || bg === 'none') return;
          const regex = /url\((['"]?)(.*?)\1\)/g;
          let match;
          while ((match = regex.exec(bg)) !== null) {
            addUrl(match[2]);
          }
        });

        performance.getEntriesByType('resource').forEach((entry) => {
          if (entry && typeof entry.name === 'string') {
            addUrl(entry.name);
          }
        });

        return Array.from(urls);
      });

      const host = new URL(pageUrl).hostname.toLowerCase();
      const defaultHostFilter = host === 'mcmaster.com' || host.endsWith('.mcmaster.com')
        ? /\/contents\/gfx\/imagecache\//i
        : null;

      const filtered = extracted.filter((url) => {
        if (includeRegex && !includeRegex.test(url)) return false;
        if (!includeRegex && defaultHostFilter && !defaultHostFilter.test(url)) return false;
        if (!/\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)(\?|$)/i.test(url) && !/\/contents\/gfx\/imagecache\//i.test(url)) {
          return false;
        }
        if (looksLikeTrackingUrl(url)) return false;
        if (looksLikeTinyPixelByHints(url)) return false;
        if (/\/init\/gfx\/home\//i.test(url)) return false;
        if (/\/browsecatalogcategoryimages\//i.test(url)) return false;
        if (/webreports\.gif/i.test(url)) return false;
        if (/\/204\.asp\b/i.test(url)) return false;
        if (/circlex\.svg/i.test(url)) return false;
        return true;
      });

      console.log(`  -> extracted ${extracted.length} URL(s), kept ${filtered.length} candidate image URL(s)`);
      totalFound += filtered.length;
      if (filtered.length === 0 || dryRun) continue;

      const cookies = await page.cookies(pageUrl);
      const cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
      const uploadBody = {
        items: toUploadItemsFromUrls(filtered, pageUrl, namespace, {
          folder: options.folder,
          tags: options.tags,
          description: options.description,
        }),
        allowInsecure,
        ...(cookieHeader ? { cookieHeader } : {}),
      };
      const { response: uploadResponse, payload: uploadPayload } = await fetchJson(
        `${baseUrl}/api/import/page/upload`,
        uploadBody
      );
      if (!uploadResponse.ok) {
        const message =
          typeof uploadPayload === 'object' && uploadPayload && typeof uploadPayload.error === 'string'
            ? uploadPayload.error
            : `upload failed (${uploadResponse.status})`;
        console.log(`  -> upload failed: ${message}`);
        totalFailed += filtered.length;
        continue;
      }
      const successCount = Number(uploadPayload?.successCount || 0);
      const failureCount = Number(uploadPayload?.failureCount || 0);
      totalUploaded += successCount;
      totalFailed += failureCount;
      console.log(`  -> uploaded ${successCount}, failed ${failureCount}`);
    }
  } finally {
    if (rl) rl.close();
    await browser.close();
  }

  console.log('\nSummary');
  console.log(`- Pages processed: ${urls.length}`);
  console.log(`- Image URLs found: ${totalFound}`);
  console.log(`- Uploaded: ${totalUploaded}`);
  console.log(`- Failed: ${totalFailed}`);
  if (dryRun) {
    console.log('- Dry run: no uploads were performed');
  }
};

const main = async () => {
  const { positional, options } = parseArgs(process.argv.slice(2));
  const command = positional[0];
  if (!command || command === 'help' || command === '--help') {
    printUsage();
    return;
  }
  if (command === 'auth-help') {
    runAuthHelp();
    return;
  }
  if (command === 'ingest') {
    await runIngest(options);
    return;
  }
  if (command === 'browser-ingest') {
    await runBrowserIngest(options);
    return;
  }
  throw new Error(`Unknown command: ${command}`);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
