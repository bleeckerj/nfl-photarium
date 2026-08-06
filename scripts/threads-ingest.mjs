#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import puppeteer from 'puppeteer';
import { buildUploadTags, contentTypeToExt, parseThreadsPostUrl, reduceVideoUrlsForUpload } from './threads-ingest/mediaHelpers.mjs';

const DEFAULT_PROFILE_DIR = path.resolve('.cache/instagram-profile');
const DEFAULT_DATA_DIR = path.resolve('data/threads');
const DEFAULT_VERBOSITY = 5;

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

const LOG_LEVEL = {
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
};

function nowStamp() {
  return new Date().toISOString();
}

function colorize(color, text, noColor = false) {
  if (noColor) return text;
  return `${color}${text}${C.reset}`;
}

function createLogger(opts) {
  const noColor = Boolean(opts.noColor);
  const verbosity = Number.isFinite(opts.verbosity) ? opts.verbosity : DEFAULT_VERBOSITY;
  const line = (tag, color, msg) =>
    `${colorize(C.gray, nowStamp(), noColor)} ${colorize(color, tag, noColor)} ${msg}`;
  return {
    error: (msg) => {
      if (verbosity >= LOG_LEVEL.error) console.error(line('[ERROR]', C.red, msg));
    },
    warn: (msg) => {
      if (verbosity >= LOG_LEVEL.warn) console.log(line('[WARN ]', C.yellow, msg));
    },
    info: (msg) => {
      if (verbosity >= LOG_LEVEL.info) console.log(line('[INFO ]', C.cyan, msg));
    },
    debug: (msg) => {
      if (verbosity >= LOG_LEVEL.debug) console.log(line('[DEBUG]', C.magenta, msg));
    },
    trace: (msg) => {
      if (verbosity >= LOG_LEVEL.trace) console.log(line('[TRACE]', C.blue, msg));
    },
    success: (msg) => {
      if (verbosity >= LOG_LEVEL.info) console.log(line('[ OK  ]', C.green, msg));
    },
    headline: (msg) => {
      if (verbosity >= LOG_LEVEL.info) console.log(colorize(C.bold + C.green, msg, noColor));
    },
  };
}

function printUsage() {
  console.log(`Threads Ingest CLI

Usage:
  node scripts/threads-ingest.mjs auth [options]
  node scripts/threads-ingest.mjs single-url --url <threads_post_url> [options]

Options:
  --username <name>         Instagram username for auth validation / fallback owner
  --profile-dir <path>      Persistent browser profile dir (default: ${DEFAULT_PROFILE_DIR})
  --output <path>           NDJSON output path (default: data/threads/single-url.ndjson)
  --url <url>               Threads post URL for single-url mode
  --api-base <url>          Base URL for local API (default: http://localhost:3000)
  --namespace <name>        Upload namespace (default: cf-default)
  --request-delay-ms <n>    Delay between per-asset push requests (default: 800)
  --push-cloudflare         Push discovered assets to local upload APIs
  --headful                 Run with visible browser window
  --no-prompt               Do not wait for Enter; auto-wait and extract
  --wait-ms <n>             Wait window in no-prompt mode (default: 8000)
  -v, --verbose             Increase verbosity (stackable)
  --quiet                   Minimal logging
  --no-color                Disable ANSI colors
  --help                    Show this help
`);
}

function parseArgs(argv) {
  const out = {
    command: null,
    username: '',
    profileDir: DEFAULT_PROFILE_DIR,
    outputPath: path.join(DEFAULT_DATA_DIR, 'single-url.ndjson'),
    threadsUrl: '',
    apiBase: 'http://localhost:3000',
    namespace: 'cf-default',
    requestDelayMs: 800,
    pushCloudflare: false,
    headful: false,
    noPrompt: false,
    waitMs: 8000,
    verbosity: DEFAULT_VERBOSITY,
    noColor: false,
  };

  const [command, ...rest] = argv;
  out.command = command ?? 'help';

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    const next = rest[i + 1];
    if (arg === '--help' || arg === '-h') out.command = 'help';
    else if (arg === '--username' && next) {
      out.username = next.trim();
      i += 1;
    } else if (arg === '--profile-dir' && next) {
      out.profileDir = path.resolve(next);
      i += 1;
    } else if (arg === '--output' && next) {
      out.outputPath = path.resolve(next);
      i += 1;
    } else if (arg === '--url' && next) {
      out.threadsUrl = next.trim();
      i += 1;
    } else if (arg === '--api-base' && next) {
      out.apiBase = next.trim().replace(/\/+$/, '');
      i += 1;
    } else if (arg === '--namespace' && next) {
      out.namespace = next.trim();
      i += 1;
    } else if (arg === '--request-delay-ms' && next) {
      out.requestDelayMs = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === '--wait-ms' && next) {
      out.waitMs = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === '--push-cloudflare') out.pushCloudflare = true;
    else if (arg === '--headful') out.headful = true;
    else if (arg === '--no-prompt') out.noPrompt = true;
    else if (arg === '--quiet') out.verbosity = 0;
    else if (arg === '--no-color') out.noColor = true;
    else if (arg === '--verbose' || arg === '-v') out.verbosity += 1;
    else if (/^-v+$/.test(arg)) out.verbosity += arg.length - 1;
  }

  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureParentDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function launchBrowser(profileDir, headless) {
  await ensureDir(profileDir);
  return puppeteer.launch({
    headless,
    userDataDir: profileDir,
    defaultViewport: null,
    args: ['--no-first-run', '--no-default-browser-check'],
  });
}

async function fetchBufferForAsset(assetUrl, referer) {
  const res = await fetch(assetUrl, {
    headers: {
      'user-agent': 'Mozilla/5.0',
      referer,
      origin: 'https://www.threads.com',
    },
  });
  if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const contentType = (res.headers.get('content-type') || '').split(';')[0].trim();
  return { bytes, contentType };
}

async function pushImageToCloudflare({ apiBase, imageUrl, uploadTags, shortcode, permalink, namespace, duplicateAction }) {
  const { bytes, contentType } = await fetchBufferForAsset(imageUrl, permalink);
  const ext = contentTypeToExt(contentType || 'image/jpeg');
  const safeShortcode = shortcode || `threads_${Date.now()}`;
  const fileName = `${safeShortcode}${ext === '.bin' ? '.jpg' : ext}`;
  const fileBlob = new Blob([bytes], { type: contentType || 'image/jpeg' });

  const form = new FormData();
  form.append('file', fileBlob, fileName);
  form.append('folder', 'threads');
  form.append('tags', uploadTags.join(','));
  form.append('sourceUrl', permalink);
  form.append('originalUrl', imageUrl);
  form.append('namespace', namespace);
  form.append('description', permalink);
  if (duplicateAction) form.append('duplicateAction', duplicateAction);

  const endpoint = `${apiBase}/api/upload`;
  const res = await fetch(endpoint, { method: 'POST', body: form });
  const bodyText = await res.text();

  let body = null;
  try {
    body = JSON.parse(bodyText);
  } catch {
    body = null;
  }

  if (!res.ok) {
    if (res.status === 409 && Array.isArray(body?.duplicates) && body.duplicates.length > 0) {
      return {
        alreadyExists: true,
        duplicateIds: body.duplicates.map((d) => d.id).filter(Boolean),
      };
    }
    const err = body?.error || body?.message || `HTTP ${res.status}`;
    throw new Error(err);
  }

  return {
    alreadyExists: false,
    id: body?.id || null,
    url: body?.url || null,
    variants: Array.isArray(body?.variants) ? body.variants : [],
  };
}

async function pushVideoToCloudflare({ apiBase, videoUrl, uploadTags, shortcode, permalink, namespace }) {
  const { bytes, contentType } = await fetchBufferForAsset(videoUrl, permalink);
  const ext = contentTypeToExt(contentType || 'video/mp4');
  const safeShortcode = shortcode || `threads_video_${Date.now()}`;
  const fileName = `${safeShortcode}${ext === '.bin' ? '.mp4' : ext}`;
  const fileBlob = new Blob([bytes], { type: contentType || 'video/mp4' });

  const form = new FormData();
  form.append('file', fileBlob, fileName);
  form.append('folder', 'threads');
  form.append('tags', uploadTags.join(','));
  form.append('originalUrl', videoUrl);
  form.append('sourceUrl', permalink);
  form.append('namespace', namespace);
  form.append('description', permalink);

  const endpoint = `${apiBase}/api/import/page/upload-video`;
  const res = await fetch(endpoint, {
    method: 'POST',
    body: form,
  });

  const bodyText = await res.text();
  let body = null;
  try {
    body = JSON.parse(bodyText);
  } catch {
    body = null;
  }

  if (!res.ok) {
    const err = body?.error || body?.message || `HTTP ${res.status}`;
    throw new Error(err);
  }

  return {
    id: body?.id || null,
    streamUid: body?.streamUid || null,
    playbackUrl: body?.playbackUrl || null,
    hlsUrl: body?.hlsUrl || null,
    thumbnailUrl: body?.thumbnailUrl || null,
    previewUrl: body?.previewUrl || null,
  };
}

async function extractSingleUrlRecord(page, threadsUrl, fallbackUsername, noPrompt, waitMs, log) {
  const observedVideoUrls = new Set();

  page.on('response', async (response) => {
    try {
      const url = response.url();
      if (!/^https?:\/\//i.test(url)) return;
      const headers = response.headers();
      const ct = String(headers['content-type'] || '').toLowerCase();
      if (
        ct.startsWith('video/') ||
        /\.(mp4|webm|mov|m4v|m3u8)(\?|$)/i.test(url) ||
        /\/video\//i.test(url)
      ) {
        observedVideoUrls.add(url);
      }
    } catch {
      // ignore event parsing errors
    }
  });

  await page.goto(threadsUrl, { waitUntil: 'networkidle2', timeout: 120000 });

  if (noPrompt) {
    log.info(`no_prompt=true wait_ms=${waitMs}`);
    await sleep(Math.max(1000, waitMs));
  } else {
    log.info('Play the Threads video in the browser window, then press Enter here to capture media URLs.');
    const rl = createInterface({ input, output });
    await rl.question('');
    rl.close();
  }

  const extracted = await page.evaluate(({ fallbackUsername }) => {
    const toList = (items) => [...new Set(items.filter((item) => typeof item === 'string' && item.length > 0))];
    const imageUrls = [];
    const videoUrls = [];

    const pushImage = (url) => {
      if (typeof url === 'string' && /^https?:\/\//i.test(url)) imageUrls.push(url);
    };
    const pushVideo = (url) => {
      if (typeof url === 'string' && /^https?:\/\//i.test(url)) videoUrls.push(url);
    };

    const readMeta = (selector) => document.querySelector(selector)?.getAttribute('content') || '';

    const metaImageSelectors = [
      'meta[property="og:image"]',
      'meta[name="og:image"]',
      'meta[property="twitter:image"]',
      'meta[name="twitter:image"]',
    ];
    const metaVideoSelectors = [
      'meta[property="og:video"]',
      'meta[property="og:video:url"]',
      'meta[name="og:video"]',
      'meta[property="twitter:player:stream"]',
      'meta[name="twitter:player:stream"]',
    ];

    for (const selector of metaImageSelectors) {
      for (const el of document.querySelectorAll(selector)) pushImage(el.getAttribute('content') || '');
    }
    for (const selector of metaVideoSelectors) {
      for (const el of document.querySelectorAll(selector)) pushVideo(el.getAttribute('content') || '');
    }

    for (const videoEl of document.querySelectorAll('video')) {
      pushVideo(videoEl.currentSrc || '');
      pushVideo(videoEl.src || '');
      pushVideo(videoEl.getAttribute('src') || '');
      for (const sourceEl of videoEl.querySelectorAll('source')) {
        pushVideo(sourceEl.getAttribute('src') || '');
      }
    }

    performance.getEntriesByType('resource').forEach((entry) => {
      if (!entry || typeof entry.name !== 'string') return;
      const url = entry.name;
      if (/\.(mp4|webm|mov|m4v|m3u8)(\?|$)/i.test(url) || /\/video\//i.test(url)) {
        pushVideo(url);
      }
      if (/\.(jpg|jpeg|png|webp|gif|avif)(\?|$)/i.test(url) || /cdninstagram/i.test(url)) {
        pushImage(url);
      }
    });

    const pathname = window.location.pathname || '';
    const parts = pathname.split('/').filter(Boolean);
    let username = null;
    let shortcode = null;
    if (parts[0]?.startsWith('@')) username = parts[0].slice(1);
    if ((parts[1] || '').toLowerCase() === 'post' && parts[2]) shortcode = parts[2];

    const title = readMeta('meta[property="og:title"]') || readMeta('meta[name="twitter:title"]');
    if (!username && typeof title === 'string') {
      const match = title.match(/\(@([a-zA-Z0-9._]+)\)/);
      if (match?.[1]) username = match[1];
    }

    const description =
      readMeta('meta[property="og:description"]') ||
      readMeta('meta[name="description"]') ||
      readMeta('meta[name="twitter:description"]') ||
      '';

    return {
      username: username || (typeof fallbackUsername === 'string' && fallbackUsername ? fallbackUsername : null),
      shortcode,
      permalink: window.location.href,
      caption: description,
      imageUrls: toList(imageUrls),
      videoUrls: toList(videoUrls),
    };
  }, { fallbackUsername });

  const combinedVideoUrls = reduceVideoUrlsForUpload([
    ...extracted.videoUrls,
    ...Array.from(observedVideoUrls),
  ]);

  return {
    source: 'threads',
    fetchedAt: new Date().toISOString(),
    username: extracted.username || fallbackUsername || null,
    shortcode: extracted.shortcode || parseThreadsPostUrl(threadsUrl)?.shortcode || null,
    permalink: extracted.permalink || threadsUrl,
    caption: extracted.caption || '',
    imageUrls: extracted.imageUrls,
    videoUrls: combinedVideoUrls,
  };
}

async function runAuth(opts, log) {
  if (!opts.username) {
    throw new Error('auth requires --username <instagram_username> for session validation.');
  }

  log.headline('Threads Auth (via Instagram Session)');
  log.info(`profile_dir=${opts.profileDir}`);
  log.info(`username=@${opts.username}`);
  log.info('This profile will be reused for Threads ingestion.');

  const browser = await launchBrowser(opts.profileDir, false);
  const page = await browser.newPage();

  await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'domcontentloaded' });
  log.info('Complete Instagram login in the opened browser window.');
  log.info('Then press Enter to validate session and open Threads.');

  const rl = createInterface({ input, output });
  await rl.question('');
  rl.close();

  await page.goto(`https://www.instagram.com/${opts.username}/`, { waitUntil: 'domcontentloaded' });

  const profile = await page.evaluate(async (username) => {
    try {
      const res = await fetch(`/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'x-ig-app-id': '936619743392459',
          'x-requested-with': 'XMLHttpRequest',
        },
      });
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
      return { status: res.status, json };
    } catch {
      return { status: 0, json: null };
    }
  }, opts.username);

  if (profile.status !== 200 || !profile.json?.data?.user?.id) {
    await browser.close();
    throw new Error(`Login validation failed (status ${profile.status}).`);
  }

  await page.goto('https://www.threads.com/', { waitUntil: 'domcontentloaded' });

  const authPath = path.join(DEFAULT_DATA_DIR, `${opts.username}.auth.json`);
  await ensureParentDir(authPath);
  await fs.writeFile(
    authPath,
    JSON.stringify(
      {
        username: opts.username,
        userId: profile.json.data.user.id,
        validatedAt: new Date().toISOString(),
        profileDir: opts.profileDir,
        authSource: 'instagram-session-for-threads',
      },
      null,
      2,
    ),
    'utf8',
  );

  await browser.close();

  log.success(`Session saved. Validation passed for @${opts.username}.`);
  log.info(`auth_metadata=${authPath}`);
}

async function runSingleUrl(opts, log) {
  if (!opts.threadsUrl) {
    throw new Error('single-url requires --url <threads_post_url>');
  }

  const parsedInput = parseThreadsPostUrl(opts.threadsUrl);
  const normalizedUrl = parsedInput?.canonicalUrl || opts.threadsUrl;

  if (opts.pushCloudflare && (opts.namespace === '__all__' || opts.namespace === '__none__')) {
    throw new Error('Invalid --namespace. Use a specific namespace, not "__all__" or "__none__".');
  }

  log.headline('Threads Single URL Ingest');
  log.info(`url=${opts.threadsUrl}`);
  if (normalizedUrl !== opts.threadsUrl) log.info(`normalized_url=${normalizedUrl}`);
  log.info(`profile_dir=${opts.profileDir}`);
  log.info(`output=${opts.outputPath}`);
  log.info(`push_cloudflare=${opts.pushCloudflare}`);

  const browser = await launchBrowser(opts.profileDir, opts.headful ? false : true);
  try {
    const page = await browser.newPage();
    const fallbackOwner = parsedInput?.usernameFromPath || opts.username || null;

    const record = await extractSingleUrlRecord(
      page,
      normalizedUrl,
      fallbackOwner,
      opts.noPrompt,
      opts.waitMs,
      log,
    );

    record.cloudflare = [];
    record.uploadTags = buildUploadTags(record.username || fallbackOwner || 'threads');

    if (record.imageUrls.length === 0 && record.videoUrls.length === 0) {
      throw new Error(
        'Could not extract media URLs from Threads page. Re-run with --headful, play the video, then press Enter.'
      );
    }

    if (opts.pushCloudflare && record.imageUrls.length > 0) {
      for (const imageUrl of record.imageUrls) {
        try {
          const pushed = await pushImageToCloudflare({
            apiBase: opts.apiBase,
            imageUrl,
            uploadTags: record.uploadTags,
            shortcode: record.shortcode,
            permalink: record.permalink,
            namespace: opts.namespace,
          });
          record.cloudflare.push({
            assetType: 'image',
            imageUrl,
            ok: true,
            alreadyExists: pushed.alreadyExists === true,
            id: pushed.id ?? null,
            url: pushed.url ?? null,
            variants: pushed.variants ?? [],
            duplicateIds: pushed.duplicateIds ?? [],
          });
        } catch (err) {
          record.cloudflare.push({
            assetType: 'image',
            imageUrl,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        if (opts.requestDelayMs > 0) await sleep(opts.requestDelayMs);
      }
    }

    if (opts.pushCloudflare && record.videoUrls.length > 0) {
      for (const videoUrl of record.videoUrls) {
        try {
          const pushed = await pushVideoToCloudflare({
            apiBase: opts.apiBase,
            videoUrl,
            uploadTags: record.uploadTags,
            shortcode: record.shortcode,
            permalink: record.permalink,
            namespace: opts.namespace,
          });

          record.cloudflare.push({
            assetType: 'video',
            videoUrl,
            ok: true,
            id: pushed.id,
            streamUid: pushed.streamUid,
            playbackUrl: pushed.playbackUrl,
            hlsUrl: pushed.hlsUrl,
            thumbnailUrl: pushed.thumbnailUrl,
            previewUrl: pushed.previewUrl,
          });
        } catch (err) {
          record.cloudflare.push({
            assetType: 'video',
            videoUrl,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        if (opts.requestDelayMs > 0) await sleep(opts.requestDelayMs);
      }
    }

    await ensureParentDir(opts.outputPath);
    await fs.appendFile(opts.outputPath, `${JSON.stringify(record)}\n`, 'utf8');

    log.success('single_url_complete');
    log.info(`shortcode=${record.shortcode || 'n/a'} owner=${record.username || 'n/a'}`);
    log.info(`images=${record.imageUrls.length} videos=${record.videoUrls.length}`);
    log.info(`output=${opts.outputPath}`);

    if (opts.pushCloudflare) {
      const pushed = record.cloudflare.filter((x) => x.ok).length;
      const failed = record.cloudflare.filter((x) => !x.ok).length;
      log.info(`cloudflare_push ok=${pushed} failed=${failed} namespace=${opts.namespace}`);
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.command || opts.command === 'help' || opts.command === '--help') {
    printUsage();
    return;
  }

  const log = createLogger(opts);

  if (opts.command === 'auth') {
    await runAuth(opts, log);
    return;
  }
  if (opts.command === 'single-url') {
    await runSingleUrl(opts, log);
    return;
  }

  throw new Error(`Unknown command: ${opts.command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
