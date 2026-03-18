#!/usr/bin/env node

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import puppeteer from "puppeteer";

const APP_ID = "936619743392459";
const DEFAULT_USERNAME = "";
const DEFAULT_PROFILE_DIR = path.resolve(".cache/instagram-profile");
const DEFAULT_DATA_DIR = path.resolve("data/instagram");
const DEFAULT_VERBOSITY = 5;

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
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
      if (verbosity >= LOG_LEVEL.error) console.error(line("[ERROR]", C.red, msg));
    },
    warn: (msg) => {
      if (verbosity >= LOG_LEVEL.warn) console.log(line("[WARN ]", C.yellow, msg));
    },
    info: (msg) => {
      if (verbosity >= LOG_LEVEL.info) console.log(line("[INFO ]", C.cyan, msg));
    },
    debug: (msg) => {
      if (verbosity >= LOG_LEVEL.debug) console.log(line("[DEBUG]", C.magenta, msg));
    },
    trace: (msg) => {
      if (verbosity >= LOG_LEVEL.trace) console.log(line("[TRACE]", C.blue, msg));
    },
    success: (msg) => {
      if (verbosity >= LOG_LEVEL.info) console.log(line("[ OK  ]", C.green, msg));
    },
    headline: (msg) => {
      if (verbosity >= LOG_LEVEL.info) console.log(colorize(C.bold + C.green, msg, noColor));
    },
  };
}

function printUsage() {
  console.log(`Instagram Ingest CLI

Usage:
  node scripts/instagram-ingest.mjs auth [options]
  node scripts/instagram-ingest.mjs ingest [options]
  node scripts/instagram-ingest.mjs single-url --url <instagram_post_or_reel_url> [options]
  node scripts/instagram-ingest.mjs videos-from-ndjson [options]

Options:
  --username <name>         Instagram username (required for auth/ingest/videos; optional fallback for single-url)
  --profile-dir <path>      Persistent browser profile dir (default: ${DEFAULT_PROFILE_DIR})
  --count <n>               Items per page (default: 12)
  --max-pages <n>           Stop after N pages (default: 0 = no limit)
  --delay-ms <n>            Delay between page fetches (default: 1200)
  --request-delay-ms <n>    Delay between per-asset push requests (default: 800)
  --output <path>           NDJSON output path (default: data/instagram/<username>.ndjson)
  --input <path>            Input NDJSON path (default: data/instagram/<username>.ndjson)
  --checkpoint <path>       Checkpoint path (default: data/instagram/<username>.checkpoint.json)
  --url <url>               Instagram post/reel URL for single-url mode
  --download-dir <path>     Optional directory to download image assets
  --push-cloudflare         Push discovered images to /api/upload/external
  --no-push-cloudflare      Disable Cloudflare pushes for single-url mode
  --skip-video-push         Skip pushing videos during ingest
  --api-base <url>          Base URL for local API (default: http://localhost:3000)
  --namespace <name>        Upload namespace (default: cf-default)
  --no-resume               Ignore existing checkpoint and start from newest page
  --headful                 Run ingest with visible browser window
  -v, --verbose             Increase verbosity (stackable)
  --quiet                   Minimal logging
  --no-color                Disable ANSI colors
  --help                    Show this help
`);
}

function parseArgs(argv) {
  const out = {
    command: null,
    username: DEFAULT_USERNAME,
    profileDir: DEFAULT_PROFILE_DIR,
    count: 12,
    maxPages: 0,
    delayMs: 1200,
    requestDelayMs: 800,
    inputPath: "",
    inputPathProvided: false,
    outputPath: "",
    checkpointPath: "",
    instagramUrl: "",
    downloadDir: "",
    pushCloudflare: false,
    skipVideoPush: false,
    apiBase: "http://localhost:3000",
    namespace: "cf-default",
    resume: true,
    headful: false,
    verbosity: DEFAULT_VERBOSITY,
    noColor: false,
    outputPathProvided: false,
  };

  const [command, ...rest] = argv;
  out.command = command ?? "help";
  if (out.command === "single-url") out.pushCloudflare = true;

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    const next = rest[i + 1];
    if (arg === "--help" || arg === "-h") out.command = "help";
    else if (arg === "--username" && next) {
      out.username = next;
      i += 1;
    } else if (arg === "--profile-dir" && next) {
      out.profileDir = path.resolve(next);
      i += 1;
    } else if (arg === "--count" && next) {
      out.count = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === "--max-pages" && next) {
      out.maxPages = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === "--delay-ms" && next) {
      out.delayMs = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === "--request-delay-ms" && next) {
      out.requestDelayMs = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === "--input" && next) {
      out.inputPath = path.resolve(next);
      out.inputPathProvided = true;
      i += 1;
    } else if (arg === "--output" && next) {
      out.outputPath = path.resolve(next);
      out.outputPathProvided = true;
      i += 1;
    } else if (arg === "--checkpoint" && next) {
      out.checkpointPath = path.resolve(next);
      i += 1;
    } else if (arg === "--url" && next) {
      out.instagramUrl = next.trim();
      i += 1;
    } else if (arg === "--download-dir" && next) {
      out.downloadDir = path.resolve(next);
      i += 1;
    } else if (arg === "--api-base" && next) {
      out.apiBase = next.trim().replace(/\/+$/, "");
      i += 1;
    } else if (arg === "--namespace" && next) {
      out.namespace = next.trim();
      i += 1;
    } else if (arg === "--push-cloudflare") out.pushCloudflare = true;
    else if (arg === "--no-push-cloudflare") out.pushCloudflare = false;
    else if (arg === "--skip-video-push") out.skipVideoPush = true;
    else if (arg === "--no-resume") out.resume = false;
    else if (arg === "--headful") out.headful = true;
    else if (arg === "--quiet") out.verbosity = 0;
    else if (arg === "--no-color") out.noColor = true;
    else if (arg === "--verbose" || arg === "-v") out.verbosity += 1;
    else if (/^-v+$/.test(arg)) out.verbosity += arg.length - 1;
  }

  const defaultUsernameBase = out.username && out.username.trim() ? out.username.trim() : "_unknown";
  if (!out.outputPath && out.command !== "single-url") {
    out.outputPath = path.join(DEFAULT_DATA_DIR, `${defaultUsernameBase}.ndjson`);
  }
  if (!out.inputPath) out.inputPath = path.join(DEFAULT_DATA_DIR, `${defaultUsernameBase}.ndjson`);
  if (!out.checkpointPath) out.checkpointPath = path.join(DEFAULT_DATA_DIR, `${defaultUsernameBase}.checkpoint.json`);

  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureParentDir(filePath) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
}

async function ensureDir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true });
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await fsp.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function bestImageCandidate(candidates = []) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    const aArea = (a.width ?? 0) * (a.height ?? 0);
    const bArea = (b.width ?? 0) * (b.height ?? 0);
    return bArea - aArea;
  })[0];
}

function extractMediaUrls(item) {
  const imageUrls = [];
  const videoUrls = [];

  const pushFromNode = (node) => {
    const candidate = bestImageCandidate(node?.image_versions2?.candidates ?? []);
    if (candidate?.url) imageUrls.push(candidate.url);
    if (Array.isArray(node?.video_versions) && node.video_versions.length > 0) {
      const bestVideo = [...node.video_versions].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
      if (bestVideo?.url) videoUrls.push(bestVideo.url);
    }
  };

  pushFromNode(item);
  if (Array.isArray(item?.carousel_media)) {
    for (const child of item.carousel_media) pushFromNode(child);
  }

  return {
    imageUrls: [...new Set(imageUrls)],
    videoUrls: [...new Set(videoUrls)],
  };
}

function mapItemToRecord(item, username, userId) {
  const { imageUrls, videoUrls } = extractMediaUrls(item);
  const shortcode = item.code ?? null;
  const takenAtUnix = item.taken_at ?? null;

  return {
    source: "instagram",
    fetchedAt: new Date().toISOString(),
    username,
    userId,
    mediaId: item.id ?? null,
    pk: item.pk ?? null,
    shortcode,
    permalink: shortcode ? `https://www.instagram.com/p/${shortcode}/` : null,
    mediaType: item.media_type ?? null,
    productType: item.product_type ?? null,
    takenAtUnix,
    takenAtIso: takenAtUnix ? new Date(takenAtUnix * 1000).toISOString() : null,
    likeCount: item.like_count ?? null,
    commentCount: item.comment_count ?? null,
    caption: item?.caption?.text ?? "",
    imageUrls,
    videoUrls,
  };
}

async function downloadFile(url, destPath) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0",
    },
  });
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  await ensureParentDir(destPath);
  await fsp.writeFile(destPath, bytes);
}

async function fetchImageBuffer(imageUrl) {
  const res = await fetch(imageUrl, {
    headers: {
      "user-agent": "Mozilla/5.0",
      referer: "https://www.instagram.com/",
      origin: "https://www.instagram.com",
    },
  });
  if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const contentType = (res.headers.get("content-type") || "").split(";")[0].trim();
  return { bytes, contentType };
}

function isRetryableVideoPushError(message) {
  const m = (message || "").toLowerCase();
  return (
    m.includes("stream api request failed (520)") ||
    m.includes("stream api request failed (502)") ||
    m.includes("stream api request failed (503)") ||
    m.includes("stream api request failed (504)") ||
    m.includes("timed out") ||
    m.includes("timeout")
  );
}

function extensionFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname).toLowerCase();
    return ext && ext.length <= 5 ? ext : ".jpg";
  } catch {
    return ".jpg";
  }
}

function parseInstagramMediaUrl(instagramUrl) {
  try {
    const parsed = new URL(instagramUrl);
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;

    for (let i = 0; i < parts.length - 1; i += 1) {
      const kind = parts[i]?.toLowerCase();
      if (kind !== "p" && kind !== "reel" && kind !== "reels" && kind !== "tv") continue;
      const shortcode = parts[i + 1] || null;
      if (!shortcode) return null;
      const profileUsername = i > 0 ? parts[i - 1] || null : null;
      return {
        kind,
        shortcode,
        profileUsername,
        canonicalUrl: `https://www.instagram.com/${kind}/${shortcode}/`,
      };
    }

    return null;
  } catch {
    return null;
  }
}

function extractShortcodeFromInstagramUrl(instagramUrl) {
  return parseInstagramMediaUrl(instagramUrl)?.shortcode || null;
}

function extractProfileUsernameFromInstagramUrl(instagramUrl) {
  return parseInstagramMediaUrl(instagramUrl)?.profileUsername || null;
}

function buildInstagramUploadTags(primaryUsername, profileUsername) {
  const tags = ["instagram"];
  const cleanPrimary = typeof primaryUsername === "string" ? primaryUsername.trim() : "";
  const cleanProfile = typeof profileUsername === "string" ? profileUsername.trim() : "";
  if (cleanPrimary) tags.push(cleanPrimary);
  if (cleanProfile) tags.push(cleanProfile);
  return [...new Set(tags)];
}

function appendSourceLabel(current, next) {
  const cleanNext = typeof next === "string" ? next.trim() : "";
  if (!cleanNext) return current || "";
  const parts = typeof current === "string" && current.trim() ? current.split("+").map((p) => p.trim()).filter(Boolean) : [];
  if (!parts.includes(cleanNext)) parts.push(cleanNext);
  return parts.join("+");
}

function scoreVideoUrlForUpload(videoUrl) {
  try {
    const parsed = new URL(videoUrl);
    const pathname = parsed.pathname.toLowerCase();
    const hasVideoExt = /\.(mp4|webm|mov|m4v|ogv|ogg)$/.test(pathname);
    const hasByteRangeHint =
      parsed.searchParams.has("bytestart") ||
      parsed.searchParams.has("byteend") ||
      parsed.searchParams.has("range");

    let score = 0;
    if (hasVideoExt) score += 20;
    if (!hasByteRangeHint) score += 60;
    if (hasByteRangeHint) score -= 40;
    if (parsed.searchParams.get("bytestart") === "0") score += 5;
    if (parsed.searchParams.has("oe")) score += 5;
    score += Math.min(10, pathname.length / 50);
    return score;
  } catch {
    return -100;
  }
}

function normalizeVideoUrlKey(videoUrl) {
  try {
    const parsed = new URL(videoUrl);
    parsed.hash = "";
    parsed.searchParams.delete("bytestart");
    parsed.searchParams.delete("byteend");
    parsed.searchParams.delete("range");
    parsed.searchParams.sort();
    return `${parsed.origin}${parsed.pathname}?${parsed.searchParams.toString()}`;
  } catch {
    return videoUrl;
  }
}

function reduceVideoUrlsForUpload(videoUrls) {
  if (!Array.isArray(videoUrls) || videoUrls.length <= 1) {
    return Array.isArray(videoUrls) ? videoUrls : [];
  }

  const bestByKey = new Map();
  for (const videoUrl of videoUrls) {
    if (typeof videoUrl !== "string" || !videoUrl.startsWith("http")) continue;
    const key = normalizeVideoUrlKey(videoUrl);
    const score = scoreVideoUrlForUpload(videoUrl);
    const current = bestByKey.get(key);
    if (!current || score > current.score) {
      bestByKey.set(key, { videoUrl, score });
    }
  }

  const reduced = [...bestByKey.values()]
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.videoUrl);

  const preferred = reduced.filter((videoUrl) => scoreVideoUrlForUpload(videoUrl) >= 0);
  return preferred.length > 0 ? preferred : reduced;
}

function contentTypeToExt(contentType) {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("jpeg") || ct.includes("jpg")) return ".jpg";
  if (ct.includes("png")) return ".png";
  if (ct.includes("webp")) return ".webp";
  if (ct.includes("gif")) return ".gif";
  if (ct.includes("svg")) return ".svg";
  return ".jpg";
}

async function pushImageToCloudflare({
  apiBase,
  imageUrl,
  username,
  uploadTags,
  shortcode,
  permalink,
  sourcePageUrl,
  namespace,
  log,
}) {
  const { bytes, contentType } = await fetchImageBuffer(imageUrl);
  const ext = contentTypeToExt(contentType || imageUrl);
  const safeShortcode = shortcode || `ig_${Date.now()}`;
  const fileName = `${safeShortcode}${ext}`;
  const fileBlob = new Blob([bytes], { type: contentType || "image/jpeg" });

  const form = new FormData();
  form.append("file", fileBlob, fileName);
  form.append("folder", "instagram");
  form.append("tags", Array.isArray(uploadTags) && uploadTags.length > 0 ? uploadTags.join(",") : `instagram,${username}`);
  form.append("sourceUrl", sourcePageUrl);
  form.append("originalUrl", imageUrl);
  form.append("namespace", namespace);
  if (permalink) form.append("description", permalink);

  const endpoint = `${apiBase}/api/upload/external`;
  log.trace(`cloudflare_push_start endpoint=${endpoint} file=${fileName}`);
  const res = await fetch(endpoint, { method: "POST", body: form });
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

async function pushVideoToCloudflare({
  apiBase,
  videoUrl,
  username,
  uploadTags,
  shortcode,
  permalink,
  sourcePageUrl,
  namespace,
  log,
}) {
  const endpoint = `${apiBase}/api/import/page/upload-video`;
  const safeShortcode = shortcode || `ig_video_${Date.now()}`;
  const { bytes, contentType } = await fetchImageBuffer(videoUrl);
  log.trace(
    `cloudflare_video_source_fetched shortcode=${safeShortcode} bytes=${bytes.byteLength} content_type=${contentType || "unknown"}`,
  );
  const ext = contentTypeToExt(contentType || "video/mp4");
  const fileName = `${safeShortcode}${ext === ".jpg" ? ".mp4" : ext}`;
  const fileBlob = new Blob([bytes], { type: contentType || "video/mp4" });

  const form = new FormData();
  form.append("file", fileBlob, fileName);
  form.append("folder", "instagram");
  form.append("tags", Array.isArray(uploadTags) && uploadTags.length > 0 ? uploadTags.join(",") : `instagram,${username}`);
  form.append("originalUrl", videoUrl);
  form.append("sourceUrl", sourcePageUrl);
  form.append("namespace", namespace);
  if (permalink) form.append("description", permalink);

  log.trace(
    `cloudflare_video_push_start endpoint=${endpoint} shortcode=${shortcode || "n/a"} mode=file_upload file=${fileName}`,
  );
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const res = await fetch(endpoint, {
      method: "POST",
      body: form,
    });
    const bodyText = await res.text();
    let body = null;
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = null;
    }

    if (res.ok) {
      return {
        id: body?.id || null,
        streamUid: body?.streamUid || null,
        playbackUrl: body?.playbackUrl || null,
        hlsUrl: body?.hlsUrl || null,
        thumbnailUrl: body?.thumbnailUrl || null,
        previewUrl: body?.previewUrl || null,
      };
    }

    const err = body?.error || body?.message || `HTTP ${res.status}`;
    const retryable = isRetryableVideoPushError(err) && attempt < maxAttempts;
    if (retryable) {
      const backoffMs = attempt * 1500;
      log.warn(
        `cloudflare_video_push_retry shortcode=${safeShortcode} attempt=${attempt}/${maxAttempts} status=${res.status} err=${err} backoff_ms=${backoffMs}`,
      );
      await sleep(backoffMs);
      continue;
    }

    throw new Error(err);
  }

  throw new Error("Unexpected video push failure.");
}

async function igGet(page, apiPath) {
  const result = await page.evaluate(
    async ({ apiPath, appId }) => {
      const res = await fetch(apiPath, {
        method: "GET",
        credentials: "include",
        headers: {
          "x-ig-app-id": appId,
          "x-requested-with": "XMLHttpRequest",
        },
      });
      const text = await res.text();
      return { status: res.status, text };
    },
    { apiPath, appId: APP_ID },
  );

  let json = null;
  try {
    json = JSON.parse(result.text);
  } catch {
    json = null;
  }
  return { status: result.status, json, text: result.text };
}

async function extractSingleUrlRecord(page, instagramUrl, fallbackUsername, log) {
  log.debug(`single_url_opening url=${instagramUrl}`);
  await page.goto(instagramUrl, { waitUntil: "domcontentloaded" });

  const extracted = await page.evaluate(({ fallbackUsername }) => {
    const toList = (items) => [...new Set(items.filter((item) => typeof item === "string" && item.length > 0))];
    const inferUsernameFromMetaText = (...candidates) => {
      for (const value of candidates) {
        if (typeof value !== "string") continue;
        const text = value.trim();
        if (!text) continue;
        const match = text.match(/([a-zA-Z0-9._]{1,30})\s+on\s+Instagram/i);
        if (match?.[1]) return match[1];
      }
      return null;
    };
    const imageUrls = [];
    const videoUrls = [];
    const notes = [];
    let sawVideoMetaTag = false;
    let sawVideoElement = false;
    let sawVideoScriptField = false;

    const pushImage = (url) => {
      if (typeof url === "string" && url.startsWith("http")) imageUrls.push(url);
    };
    const pushVideo = (url) => {
      if (typeof url === "string" && url.startsWith("http")) videoUrls.push(url);
    };

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
      for (const el of document.querySelectorAll(selector)) {
        pushImage(el.getAttribute("content") || "");
      }
    }
    for (const selector of metaVideoSelectors) {
      for (const el of document.querySelectorAll(selector)) {
        sawVideoMetaTag = true;
        pushVideo(el.getAttribute("content") || "");
      }
    }

    for (const videoEl of document.querySelectorAll("video")) {
      sawVideoElement = true;
      pushVideo(videoEl.currentSrc || "");
      pushVideo(videoEl.src || "");
      pushVideo(videoEl.getAttribute("src") || "");
      const nestedSources = videoEl.querySelectorAll("source");
      for (const sourceEl of nestedSources) {
        pushVideo(sourceEl.getAttribute("src") || "");
      }
    }

    for (const sourceEl of document.querySelectorAll("source")) {
      const type = (sourceEl.getAttribute("type") || "").toLowerCase();
      const src = sourceEl.getAttribute("src") || "";
      if (type.startsWith("video/") || /\.(mp4|webm|mov|m4v|ogv|ogg)(\?|$)/i.test(src)) {
        pushVideo(src);
      }
    }

    const weakSeen = new WeakSet();
    const scanNode = (value, depth = 0) => {
      if (!value || depth > 10) return;
      if (Array.isArray(value)) {
        for (const item of value) scanNode(item, depth + 1);
        return;
      }
      if (typeof value !== "object") return;
      if (weakSeen.has(value)) return;
      weakSeen.add(value);

      if (typeof value.display_url === "string") pushImage(value.display_url);
      if (typeof value.thumbnail_src === "string") pushImage(value.thumbnail_src);
      if (typeof value.video_url === "string") pushVideo(value.video_url);
      if (Array.isArray(value.video_versions)) {
        for (const v of value.video_versions) {
          if (typeof v?.url === "string") pushVideo(v.url);
        }
      }
      if (Array.isArray(value.image_versions2?.candidates)) {
        for (const c of value.image_versions2.candidates) {
          if (typeof c?.url === "string") pushImage(c.url);
        }
      }

      for (const nested of Object.values(value)) {
        if (nested && typeof nested === "object") scanNode(nested, depth + 1);
      }
    };

    let mediaNode = null;
    let jsonLdUsername = null;
    const scriptNodes = document.querySelectorAll("script:not([src])");
    for (const script of scriptNodes) {
      const text = script.textContent || "";
      if (!text.trim()) continue;
      try {
        const parsed = JSON.parse(text);
        scanNode(parsed);
        if (!jsonLdUsername && parsed?.author && typeof parsed.author === "object") {
          const candidate =
            parsed.author.alternateName ||
            parsed.author.identifier ||
            parsed.author.name ||
            null;
          if (typeof candidate === "string") {
            jsonLdUsername = candidate.startsWith("@") ? candidate.slice(1) : candidate;
          }
        }
        const candidate =
          parsed?.graphql?.shortcode_media ||
          parsed?.data?.xdt_shortcode_media ||
          parsed?.xdt_shortcode_media ||
          null;
        if (!mediaNode && candidate && typeof candidate === "object") {
          mediaNode = candidate;
        }
      } catch {
        const videoFieldPatterns = [
          new RegExp(String.raw`"video_url"\s*:\s*"(https:\\/\\/[^"\\]+)"`, "gi"),
          new RegExp(String.raw`"video_versions"\s*:\s*\[[\s\S]*?"url"\s*:\s*"(https:\\/\\/[^"\\]+)"`, "gi"),
        ];
        for (const pattern of videoFieldPatterns) {
          pattern.lastIndex = 0;
          let match = null;
          while ((match = pattern.exec(text)) !== null) {
            const raw = match?.[1];
            if (typeof raw === "string" && raw.length > 0) {
              sawVideoScriptField = true;
              pushVideo(raw.replace(/\\\//g, "/"));
            }
          }
        }
        if (!text.includes("shortcode_media") && !text.includes("xdt_shortcode_media")) continue;
        const marker = text.includes("xdt_shortcode_media") ? "xdt_shortcode_media" : "shortcode_media";
        const start = text.indexOf(marker);
        if (start >= 0) notes.push(`found_marker:${marker}`);
      }
    }

    if (mediaNode) {
      scanNode(mediaNode);
    }

    const pathname = window.location.pathname || "";
    const parts = pathname.split("/").filter(Boolean);
    let shortcode = null;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const kind = (parts[i] || "").toLowerCase();
      if (kind === "p" || kind === "reel" || kind === "reels" || kind === "tv") {
        shortcode = parts[i + 1] || null;
        break;
      }
    }
    const permalink = window.location.href;
    const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute("content") || "";
    const ogDescription = document.querySelector('meta[property="og:description"]')?.getAttribute("content") || "";
    const twitterTitle = document.querySelector('meta[name="twitter:title"]')?.getAttribute("content") || "";
    const inferredMetaUsername = inferUsernameFromMetaText(ogTitle, ogDescription, twitterTitle);
    const usernameFromOwner = mediaNode?.owner?.username || null;
    const usernameFromJsonLd = jsonLdUsername || null;
    const usernameFromFallback =
      typeof fallbackUsername === "string" && fallbackUsername ? fallbackUsername : null;
    const username = usernameFromOwner || usernameFromJsonLd || usernameFromFallback;
    const usernameSource = usernameFromOwner
      ? "owner"
      : usernameFromJsonLd
        ? "jsonld"
        : usernameFromFallback
          ? "fallback_arg"
          : "unresolved";
    const userId = mediaNode?.owner?.id || null;
    const mediaId = mediaNode?.id || null;
    const pk = mediaNode?.pk || null;
    const caption =
      mediaNode?.edge_media_to_caption?.edges?.[0]?.node?.text ||
      mediaNode?.caption?.text ||
      "";
    const takenAtUnix =
      Number.isFinite(mediaNode?.taken_at_timestamp)
        ? Number(mediaNode.taken_at_timestamp)
        : Number.isFinite(mediaNode?.taken_at)
          ? Number(mediaNode.taken_at)
          : null;

    const typename = mediaNode?.__typename || "";
    let mediaType = mediaNode?.media_type ?? null;
    if (mediaType == null) {
      if (typename === "GraphVideo") mediaType = 2;
      else if (typename === "GraphSidecar") mediaType = 8;
      else if (typename === "GraphImage") mediaType = 1;
    }

    const productType = mediaNode?.product_type || null;
    const likelyVideo =
      mediaType === 2 ||
      productType === "clips" ||
      sawVideoMetaTag ||
      sawVideoElement ||
      sawVideoScriptField;
    return {
      username,
      userId,
      mediaId,
      pk,
      shortcode,
      permalink,
      mediaType,
      productType,
      takenAtUnix,
      caption,
      imageUrls: toList(imageUrls),
      videoUrls: toList(videoUrls),
      notes,
      inferredMetaUsername,
      likelyVideo,
      usernameSource,
      videoSignals: {
        metaTag: sawVideoMetaTag,
        videoElement: sawVideoElement,
        scriptField: sawVideoScriptField,
      },
    };
  }, { fallbackUsername });

  const username = extracted.username || fallbackUsername;
  const takenAtIso = extracted.takenAtUnix ? new Date(extracted.takenAtUnix * 1000).toISOString() : null;

  const record = {
    source: "instagram",
    fetchedAt: new Date().toISOString(),
    username,
    userId: extracted.userId || null,
    mediaId: extracted.mediaId || null,
    pk: extracted.pk || null,
    shortcode: extracted.shortcode || extractShortcodeFromInstagramUrl(instagramUrl),
    permalink: extracted.permalink || instagramUrl,
    mediaType: extracted.mediaType ?? null,
    productType: extracted.productType ?? null,
    takenAtUnix: extracted.takenAtUnix ?? null,
    takenAtIso,
    likeCount: null,
    commentCount: null,
    caption: extracted.caption || "",
    imageUrls: Array.isArray(extracted.imageUrls) ? extracted.imageUrls : [],
    videoUrls: Array.isArray(extracted.videoUrls) ? extracted.videoUrls : [],
    likelyVideo: extracted.likelyVideo === true,
    username_source: extracted.usernameSource || "unresolved",
    video_source:
      Array.isArray(extracted.videoUrls) && extracted.videoUrls.length > 0 ? "page_extract" : "none",
  };

  if (record.imageUrls.length === 0 && record.videoUrls.length === 0) {
    throw new Error("Could not extract media URLs from Instagram page. Re-run auth and retry with --headful.");
  }

  if (Array.isArray(extracted.notes) && extracted.notes.length > 0) {
    log.trace(`single_url_extract_notes notes=${extracted.notes.join(",")}`);
  }
  if (extracted.likelyVideo) {
    const signals = extracted.videoSignals || {};
    log.trace(
      `single_url_video_signals likely_video=true meta=${Boolean(signals.metaTag)} video_el=${Boolean(signals.videoElement)} script=${Boolean(signals.scriptField)}`,
    );
  }
  if (extracted.inferredMetaUsername && extracted.inferredMetaUsername !== record.username) {
    log.trace(
      `single_url_meta_username_ignored meta_username=${extracted.inferredMetaUsername} reason=display_name_can_masquerade_as_username`,
    );
  }

  return record;
}

async function fetchSingleUrlRecordFromApiByShortcode(page, shortcode, fallbackUsername, fallbackUserId, log) {
  if (!shortcode) return null;
  const apiPath = `/api/v1/media/${encodeURIComponent(shortcode)}/info/`;
  log.debug(`single_url_api_fallback_fetch shortcode=${shortcode} api_path=${apiPath}`);
  const resp = await igGet(page, apiPath);
  if (resp.status !== 200) {
    log.warn(`single_url_api_fallback_failed shortcode=${shortcode} status=${resp.status}`);
    return null;
  }

  const item = Array.isArray(resp.json?.items) ? resp.json.items[0] : null;
  if (!item || typeof item !== "object") {
    log.warn(`single_url_api_fallback_empty shortcode=${shortcode}`);
    return null;
  }

  const username = item?.user?.username || fallbackUsername;
  const userId = item?.user?.pk || item?.user?.id || fallbackUserId || null;
  const mapped = mapItemToRecord(item, username, userId);
  mapped.shortcode = mapped.shortcode || shortcode;
  mapped.permalink = mapped.permalink || `https://www.instagram.com/reel/${shortcode}/`;
  return mapped;
}

async function fetchSingleUrlRecordFromUserFeedByShortcode(page, username, shortcode, log) {
  if (!username || !shortcode) return null;

  const profileResp = await igGet(
    page,
    `/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
  );
  if (profileResp.status !== 200 || !profileResp.json?.data?.user?.id) {
    log.warn(
      `single_url_feed_fallback_profile_failed username=${username} status=${profileResp.status}`,
    );
    return null;
  }

  const userId = profileResp.json.data.user.id;
  let maxId = "";
  const maxPages = 8;
  const perPage = 12;

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const apiPath =
      `/api/v1/feed/user/${encodeURIComponent(userId)}/?count=${encodeURIComponent(perPage)}` +
      (maxId ? `&max_id=${encodeURIComponent(maxId)}` : "");
    const feedResp = await igGet(page, apiPath);
    if (feedResp.status !== 200 || !feedResp.json) {
      log.warn(
        `single_url_feed_fallback_page_failed username=${username} status=${feedResp.status} page=${pageIndex + 1}`,
      );
      return null;
    }

    const items = Array.isArray(feedResp.json.items) ? feedResp.json.items : [];
    const found = items.find((item) => item?.code === shortcode);
    if (found) {
      const mapped = mapItemToRecord(found, username, userId);
      mapped.shortcode = mapped.shortcode || shortcode;
      return mapped;
    }

    const nextMaxId = feedResp.json.next_max_id ?? "";
    if (!nextMaxId) break;
    maxId = nextMaxId;
  }

  log.warn(`single_url_feed_fallback_not_found username=${username} shortcode=${shortcode}`);
  return null;
}

async function launchBrowser(profileDir, headless) {
  await ensureDir(profileDir);
  return puppeteer.launch({
    headless,
    userDataDir: profileDir,
    defaultViewport: null,
    args: ["--no-first-run", "--no-default-browser-check"],
  });
}

async function runAuth(opts, log) {
  log.headline("Instagram Auth");
  log.info(`profile_dir=${opts.profileDir}`);
  log.info(`username=@${opts.username}`);
  log.debug("Launching Chromium with persistent profile for login reuse.");
  const browser = await launchBrowser(opts.profileDir, false);
  const page = await browser.newPage();
  await page.goto("https://www.instagram.com/accounts/login/", { waitUntil: "domcontentloaded" });

  log.info("Complete Instagram login in the opened browser window.");
  log.info(`When done, press Enter here to validate session for @${opts.username}.`);

  const rl = createInterface({ input, output });
  await rl.question("");
  rl.close();

  log.debug("Validating login state using web_profile_info endpoint.");
  await page.goto(`https://www.instagram.com/${opts.username}/`, { waitUntil: "domcontentloaded" });
  const profile = await igGet(page, `/api/v1/users/web_profile_info/?username=${encodeURIComponent(opts.username)}`);

  if (profile.status !== 200 || !profile.json?.data?.user?.id) {
    await browser.close();
    throw new Error(
      `Login validation failed (status ${profile.status}). Open the profile in browser and retry auth.`,
    );
  }

  const authPath = path.join(DEFAULT_DATA_DIR, `${opts.username}.auth.json`);
  await ensureParentDir(authPath);
  await fsp.writeFile(
    authPath,
    JSON.stringify(
      {
        username: opts.username,
        userId: profile.json.data.user.id,
        validatedAt: new Date().toISOString(),
        profileDir: opts.profileDir,
      },
      null,
      2,
    ),
    "utf8",
  );

  await browser.close();
  log.success(`Session saved. Validation passed for @${opts.username}.`);
  log.info(`auth_metadata=${authPath}`);
}

async function runIngest(opts, log) {
  log.headline("Instagram Ingest");
  log.info(`username=@${opts.username}`);
  log.info(`profile_dir=${opts.profileDir}`);
  log.info(`output=${opts.outputPath || "(auto; will route after owner resolution)"}`);
  log.info(`checkpoint=${opts.checkpointPath}`);
  log.info(
    `resume=${opts.resume} count=${opts.count} delay_ms=${opts.delayMs} request_delay_ms=${opts.requestDelayMs} max_pages=${opts.maxPages || "unbounded"}`,
  );
  if (opts.downloadDir) log.info(`download_dir=${opts.downloadDir}`);
  if (opts.pushCloudflare) {
    if (opts.namespace === "__all__" || opts.namespace === "__none__") {
      throw new Error('Invalid --namespace. Use a specific namespace, not "__all__" or "__none__".');
    }
    log.info(`push_cloudflare=true api_base=${opts.apiBase}`);
    log.info(`push_namespace=${opts.namespace}`);
    log.info(`push_tags=instagram,${opts.username} push_folder=instagram`);
    if (opts.skipVideoPush) {
      log.warn("skip_video_push=true (videos will be deferred; only images pushed during ingest)");
    }
  } else {
    log.warn("push_cloudflare=false (use --push-cloudflare to catalog assets in Cloudflare).");
  }

  log.debug(`Launching browser in ${opts.headful ? "headful" : "headless"} mode.`);
  const browser = await launchBrowser(opts.profileDir, opts.headful ? false : true);
  const page = await browser.newPage();

  log.debug("Opening profile page and fetching profile metadata.");
  await page.goto(`https://www.instagram.com/${opts.username}/`, { waitUntil: "domcontentloaded" });
  const profileResp = await igGet(page, `/api/v1/users/web_profile_info/?username=${encodeURIComponent(opts.username)}`);

  if (profileResp.status === 401 || profileResp.json?.require_login) {
    await browser.close();
    throw new Error("Login required. Run `node scripts/instagram-ingest.mjs auth --username <name>` first.");
  }
  if (profileResp.status !== 200 || !profileResp.json?.data?.user?.id) {
    await browser.close();
    throw new Error(`Failed to read profile data (status ${profileResp.status}).`);
  }

  const user = profileResp.json.data.user;
  const userId = user.id;
  const totalCount = user?.edge_owner_to_timeline_media?.count ?? null;
  log.success(`profile_ok user_id=${userId} profile_media_count=${totalCount ?? "unknown"}`);

  const checkpoint = opts.resume ? await readJsonIfExists(opts.checkpointPath) : null;
  let maxId = checkpoint?.nextMaxId ?? "";
  if (checkpoint) {
    log.info(
      `resume_checkpoint found pages_fetched=${checkpoint.pagesFetched ?? 0} records_written=${checkpoint.recordsWritten ?? 0} next_max_id=${checkpoint.nextMaxId ?? "null"}`,
    );
  } else if (opts.resume) {
    log.info("resume_checkpoint not found; starting at newest.");
  } else {
    log.info("resume disabled; starting at newest.");
  }

  let pageCount = 0;
  let recordCount = 0;
  let downloadedCount = 0;
  let downloadFailCount = 0;
  let cloudflareImagePushOk = 0;
  let cloudflareImageAlreadyExists = 0;
  let cloudflareImagePushFail = 0;
  let cloudflareVideoPushOk = 0;
  let cloudflareVideoPushFail = 0;

  await ensureParentDir(opts.outputPath);
  const out = fs.createWriteStream(opts.outputPath, { flags: "a" });

  if (opts.downloadDir) await ensureDir(opts.downloadDir);

  while (true) {
    const apiPath =
      `/api/v1/feed/user/${encodeURIComponent(userId)}/?count=${encodeURIComponent(opts.count)}` +
      (maxId ? `&max_id=${encodeURIComponent(maxId)}` : "");
    log.debug(`fetch_page index=${pageCount + 1} max_id=${maxId || "null"} api_path=${apiPath}`);

    const resp = await igGet(page, apiPath);
    if (resp.status === 401 || resp.json?.require_login) {
      log.error(`auth_required status=${resp.status}`);
      throw new Error("Session expired or blocked (require_login). Re-run auth and resume.");
    }
    if (resp.status !== 200 || !resp.json) {
      log.error(`feed_error status=${resp.status}`);
      throw new Error(`Feed request failed (status ${resp.status}).`);
    }

    const items = Array.isArray(resp.json.items) ? resp.json.items : [];
    log.info(`page_result index=${pageCount + 1} status=${resp.status} items=${items.length}`);
    if (items.length === 0) {
      log.info("No more items on this page; stopping.");
      break;
    }

    for (const item of items) {
      const record = mapItemToRecord(item, opts.username, userId);
      record.cloudflare = [];
      const captionPreview = (record.caption || "").replace(/\s+/g, " ").slice(0, 80);
      log.trace(
        `item media_id=${record.mediaId} shortcode=${record.shortcode ?? "n/a"} type=${record.mediaType} images=${record.imageUrls.length} videos=${record.videoUrls.length} caption="${captionPreview}"`,
      );

      if (opts.downloadDir) {
        for (let idx = 0; idx < record.imageUrls.length; idx += 1) {
          const imageUrl = record.imageUrls[idx];
          const ext = extensionFromUrl(imageUrl);
          const short = record.shortcode ?? record.mediaId ?? "unknown";
          const fileName = `${short}_${idx + 1}${ext}`;
          const destPath = path.join(opts.downloadDir, fileName);
          if (!fs.existsSync(destPath)) {
            try {
              log.trace(`download_start url=${imageUrl} dest=${destPath}`);
              await downloadFile(imageUrl, destPath);
              downloadedCount += 1;
              log.trace(`download_ok dest=${destPath}`);
            } catch (err) {
              downloadFailCount += 1;
              log.warn(`download_failed url=${imageUrl} err=${err.message}`);
            }
          } else {
            log.trace(`download_skip_exists dest=${destPath}`);
          }
        }
      }

      if (opts.pushCloudflare && record.mediaType === 2 && record.imageUrls.length > 0) {
        log.trace(
          `cloudflare_image_skip_video_post shortcode=${record.shortcode ?? "n/a"} media_type=${record.mediaType} images=${record.imageUrls.length}`,
        );
      } else if (opts.pushCloudflare && record.imageUrls.length > 0) {
        const sourcePageUrl = `https://www.instagram.com/${opts.username}/`;
        for (const imageUrl of record.imageUrls) {
          try {
            const pushed = await pushImageToCloudflare({
              apiBase: opts.apiBase,
              imageUrl,
              username: opts.username,
              shortcode: record.shortcode,
              permalink: record.permalink,
              sourcePageUrl,
              namespace: opts.namespace,
              log,
            });
            record.cloudflare.push({
              assetType: "image",
              imageUrl,
              ok: true,
              alreadyExists: pushed.alreadyExists === true,
              id: pushed.id ?? null,
              url: pushed.url ?? null,
              variants: pushed.variants ?? [],
              duplicateIds: pushed.duplicateIds ?? [],
            });
            if (pushed.alreadyExists) {
              cloudflareImageAlreadyExists += 1;
              log.trace(
                `cloudflare_push_exists shortcode=${record.shortcode ?? "n/a"} image=${imageUrl} duplicate_ids=${(pushed.duplicateIds ?? []).join(",") || "n/a"}`,
              );
            } else {
              cloudflareImagePushOk += 1;
              log.trace(
                `cloudflare_push_ok shortcode=${record.shortcode ?? "n/a"} image=${imageUrl} id=${pushed.id ?? "n/a"}`,
              );
            }
          } catch (err) {
            cloudflareImagePushFail += 1;
            record.cloudflare.push({
              assetType: "image",
              imageUrl,
              ok: false,
              error: err.message,
            });
            log.warn(
              `cloudflare_push_failed shortcode=${record.shortcode ?? "n/a"} image=${imageUrl} err=${err.message}`,
            );
          }
          if (opts.requestDelayMs > 0) {
            log.trace(`request_sleep_ms=${opts.requestDelayMs} after=image_push`);
            await sleep(opts.requestDelayMs);
          }
        }
      }

      if (opts.pushCloudflare && opts.skipVideoPush && record.videoUrls.length > 0) {
        log.trace(
          `cloudflare_video_skip shortcode=${record.shortcode ?? "n/a"} reason=skip_video_push urls=${record.videoUrls.length}`,
        );
      } else if (opts.pushCloudflare && record.videoUrls.length > 0) {
        const sourcePageUrl = `https://www.instagram.com/${opts.username}/`;
        for (const videoUrl of record.videoUrls) {
          try {
            const pushed = await pushVideoToCloudflare({
              apiBase: opts.apiBase,
              videoUrl,
              username: opts.username,
              shortcode: record.shortcode,
              permalink: record.permalink,
              sourcePageUrl,
              namespace: opts.namespace,
              log,
            });
            cloudflareVideoPushOk += 1;
            record.cloudflare.push({
              assetType: "video",
              videoUrl,
              ok: true,
              id: pushed.id,
              streamUid: pushed.streamUid,
              playbackUrl: pushed.playbackUrl,
              hlsUrl: pushed.hlsUrl,
              thumbnailUrl: pushed.thumbnailUrl,
              previewUrl: pushed.previewUrl,
            });
            log.trace(
              `cloudflare_video_push_ok shortcode=${record.shortcode ?? "n/a"} video=${videoUrl} id=${pushed.id ?? "n/a"} stream_uid=${pushed.streamUid ?? "n/a"}`,
            );
          } catch (err) {
            cloudflareVideoPushFail += 1;
            record.cloudflare.push({
              assetType: "video",
              videoUrl,
              ok: false,
              error: err.message,
            });
            log.warn(
              `cloudflare_video_push_failed shortcode=${record.shortcode ?? "n/a"} video=${videoUrl} err=${err.message}`,
            );
          }
          if (opts.requestDelayMs > 0) {
            log.trace(`request_sleep_ms=${opts.requestDelayMs} after=video_push`);
            await sleep(opts.requestDelayMs);
          }
        }
      } else if (opts.pushCloudflare && record.mediaType === 2 && record.videoUrls.length === 0) {
        log.warn(
          `cloudflare_video_missing shortcode=${record.shortcode ?? "n/a"} media_type=2 has no videoUrls in payload`,
        );
      }

      out.write(`${JSON.stringify(record)}\n`);
      recordCount += 1;
    }

    pageCount += 1;
    maxId = resp.json.next_max_id ?? "";

    await ensureParentDir(opts.checkpointPath);
    await fsp.writeFile(
      opts.checkpointPath,
      JSON.stringify(
        {
          username: opts.username,
          userId,
          totalProfileCount: totalCount,
          pagesFetched: pageCount,
          recordsWritten: recordCount,
          nextMaxId: maxId || null,
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );
    log.debug(
      `checkpoint_saved pages_fetched=${pageCount} records_written=${recordCount} next_max_id=${maxId || "null"}`,
    );

    if (!maxId) {
      log.info("No next_max_id returned; reached end.");
      break;
    }
    if (opts.maxPages > 0 && pageCount >= opts.maxPages) {
      log.info(`Reached max_pages=${opts.maxPages}; stopping.`);
      break;
    }
    if (opts.delayMs > 0) {
      log.trace(`sleep delay_ms=${opts.delayMs}`);
      await sleep(opts.delayMs);
    }
  }

  out.end();
  await browser.close();

  log.success(`Ingest complete for @${opts.username}`);
  log.success(`records_written=${recordCount} pages_fetched=${pageCount}`);
  log.info(`output=${opts.outputPath || "(auto; will route after owner resolution)"}`);
  log.info(`checkpoint=${opts.checkpointPath}`);
  if (opts.downloadDir) {
    log.info(`download_dir=${opts.downloadDir} downloaded=${downloadedCount} download_failures=${downloadFailCount}`);
  }
  if (opts.pushCloudflare) {
    log.info(
      `cloudflare_push images_uploaded=${cloudflareImagePushOk} images_exists=${cloudflareImageAlreadyExists} images_failed=${cloudflareImagePushFail} videos_uploaded=${cloudflareVideoPushOk} videos_failed=${cloudflareVideoPushFail}`,
    );
  }
}

async function runVideosFromNdjson(opts, log) {
  log.headline("Instagram Video Replay");
  log.info(`input=${opts.inputPath}`);
  log.info(`api_base=${opts.apiBase}`);
  if (opts.namespace === "__all__" || opts.namespace === "__none__") {
    throw new Error('Invalid --namespace. Use a specific namespace, not "__all__" or "__none__".');
  }
  log.info(`push_namespace=${opts.namespace}`);
  log.info(`request_delay_ms=${opts.requestDelayMs}`);
  log.info(`push_tags=instagram,${opts.username || "(from rows)"} push_folder=instagram`);

  const raw = await fsp.readFile(opts.inputPath, "utf8");
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  log.info(`ndjson_lines=${lines.length}`);

  const queue = [];
  const seen = new Set();
  let rowsWithLikelyVideoNoUrl = 0;
  let rowsWithAnyVideoCandidates = 0;
  for (const line of lines) {
    let row = null;
    try {
      row = JSON.parse(line);
    } catch {
      log.warn("ndjson_parse_failed; skipping line");
      continue;
    }
    const username = row?.username || opts.username || "instagram";
    const rowPermalink =
      typeof row?.permalink === "string" && row.permalink.trim() ? row.permalink.trim() : null;
    const shortcode =
      row?.shortcode ||
      (rowPermalink ? extractShortcodeFromInstagramUrl(rowPermalink) : null) ||
      null;
    const permalink =
      rowPermalink ||
      (shortcode ? `https://www.instagram.com/p/${shortcode}/` : `https://www.instagram.com/${username}/`);
    const sourcePageUrl = permalink || `https://www.instagram.com/${username}/`;

    const candidateVideoUrls = [];
    if (Array.isArray(row?.videoUrls)) candidateVideoUrls.push(...row.videoUrls);
    if (Array.isArray(row?.video_urls)) candidateVideoUrls.push(...row.video_urls);
    if (typeof row?.videoUrl === "string") candidateVideoUrls.push(row.videoUrl);
    if (Array.isArray(row?.cloudflare)) {
      for (const asset of row.cloudflare) {
        if (asset?.assetType === "video" && typeof asset?.videoUrl === "string") {
          candidateVideoUrls.push(asset.videoUrl);
        }
      }
    }

    const reducedVideoUrls = reduceVideoUrlsForUpload(candidateVideoUrls);
    if (reducedVideoUrls.length > 0) rowsWithAnyVideoCandidates += 1;
    if (row?.likelyVideo === true && reducedVideoUrls.length === 0) {
      rowsWithLikelyVideoNoUrl += 1;
    }

    for (const videoUrl of reducedVideoUrls) {
      const key = `${shortcode || "no_shortcode"}|${videoUrl}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({ username, shortcode, permalink, sourcePageUrl, videoUrl });
    }
  }

  log.info(`rows_with_video_candidates=${rowsWithAnyVideoCandidates}`);
  if (rowsWithLikelyVideoNoUrl > 0) {
    log.warn(`rows_likely_video_but_no_video_url=${rowsWithLikelyVideoNoUrl}`);
  }
  log.info(`video_queue_size=${queue.length}`);

  let uploaded = 0;
  let failed = 0;
  for (let i = 0; i < queue.length; i += 1) {
    const item = queue[i];
    log.trace(
      `video_replay_item index=${i + 1}/${queue.length} shortcode=${item.shortcode ?? "n/a"} url=${item.videoUrl}`,
    );
    try {
      const pushed = await pushVideoToCloudflare({
        apiBase: opts.apiBase,
        videoUrl: item.videoUrl,
        username: item.username,
        shortcode: item.shortcode,
        permalink: item.permalink,
        sourcePageUrl: item.sourcePageUrl,
        namespace: opts.namespace,
        log,
      });
      uploaded += 1;
      log.trace(
        `video_replay_ok shortcode=${item.shortcode ?? "n/a"} id=${pushed.id ?? "n/a"} stream_uid=${pushed.streamUid ?? "n/a"}`,
      );
    } catch (err) {
      failed += 1;
      log.warn(`video_replay_failed shortcode=${item.shortcode ?? "n/a"} err=${err.message}`);
    }
    if (opts.requestDelayMs > 0) {
      log.trace(`request_sleep_ms=${opts.requestDelayMs} after=video_replay_push`);
      await sleep(opts.requestDelayMs);
    }
  }

  log.success(`video_replay_complete uploaded=${uploaded} failed=${failed} queued=${queue.length}`);
}

async function runSingleUrl(opts, log) {
  if (!opts.instagramUrl) {
    throw new Error("single-url requires --url <instagram_post_or_reel_url>");
  }

  const parsedInputUrl = parseInstagramMediaUrl(opts.instagramUrl);
  const normalizedInstagramUrl = parsedInputUrl?.canonicalUrl || opts.instagramUrl;

  log.headline("Instagram Single URL Ingest");
  log.info(`url=${opts.instagramUrl}`);
  if (normalizedInstagramUrl !== opts.instagramUrl) {
    log.info(`normalized_url=${normalizedInstagramUrl}`);
  }
  log.info(`profile_dir=${opts.profileDir}`);
  log.info(`output=${opts.outputPath || "(auto; will route after owner resolution)"}`);
  log.info(`push_cloudflare=${opts.pushCloudflare}`);

  const profileUsername = parsedInputUrl?.profileUsername || extractProfileUsernameFromInstagramUrl(opts.instagramUrl) || opts.username;

  if (opts.pushCloudflare) {
    if (opts.namespace === "__all__" || opts.namespace === "__none__") {
      throw new Error('Invalid --namespace. Use a specific namespace, not "__all__" or "__none__".');
    }
    log.info(`api_base=${opts.apiBase}`);
    log.info(`push_namespace=${opts.namespace}`);
    log.info(
      `push_tags=${buildInstagramUploadTags(opts.username, profileUsername).join(",")} push_folder=instagram`,
    );
  }

  const browser = await launchBrowser(opts.profileDir, opts.headful ? false : true);
  try {
    const page = await browser.newPage();

    const record = await extractSingleUrlRecord(page, normalizedInstagramUrl, opts.username, log);
    record.cloudflare = [];
    record.profileUsername = profileUsername;
    record.uploadTags = buildInstagramUploadTags(record.username || opts.username, profileUsername);

    if (record.videoUrls.length === 0 && record.shortcode) {
      const apiFallback = await fetchSingleUrlRecordFromApiByShortcode(
        page,
        record.shortcode,
        record.username || opts.username,
        record.userId || null,
        log,
      );
      if (apiFallback) {
        record.mediaType = record.mediaType ?? apiFallback.mediaType ?? null;
        record.productType = record.productType ?? apiFallback.productType ?? null;
        record.userId = record.userId || apiFallback.userId || null;
        record.mediaId = record.mediaId || apiFallback.mediaId || null;
        record.pk = record.pk || apiFallback.pk || null;
        if (!record.caption && apiFallback.caption) record.caption = apiFallback.caption;
        if (!record.takenAtUnix && apiFallback.takenAtUnix) {
          record.takenAtUnix = apiFallback.takenAtUnix;
          record.takenAtIso = apiFallback.takenAtIso;
        }
        if ((!record.username || record.username === opts.username) && apiFallback.username) {
          record.username = apiFallback.username;
          record.username_source = "api_fallback";
        }
        const mergedImages = [...record.imageUrls, ...apiFallback.imageUrls];
        const mergedVideos = [...record.videoUrls, ...apiFallback.videoUrls];
        const hadVideoBefore = record.videoUrls.length > 0;
        record.imageUrls = [...new Set(mergedImages.filter(Boolean))];
        record.videoUrls = [...new Set(mergedVideos.filter(Boolean))];
        if (record.videoUrls.length > 0 && apiFallback.videoUrls.length > 0) {
          record.video_source = appendSourceLabel(
            hadVideoBefore ? record.video_source : "",
            "api_fallback",
          );
        }
        log.info(
          `single_url_api_fallback_merged shortcode=${record.shortcode} images=${record.imageUrls.length} videos=${record.videoUrls.length}`,
        );
      }
    }

    if (record.videoUrls.length === 0 && record.shortcode && profileUsername) {
      const feedFallback = await fetchSingleUrlRecordFromUserFeedByShortcode(
        page,
        profileUsername,
        record.shortcode,
        log,
      );
      if (feedFallback) {
        record.mediaType = record.mediaType ?? feedFallback.mediaType ?? null;
        record.productType = record.productType ?? feedFallback.productType ?? null;
        record.userId = record.userId || feedFallback.userId || null;
        record.mediaId = record.mediaId || feedFallback.mediaId || null;
        record.pk = record.pk || feedFallback.pk || null;
        if (!record.caption && feedFallback.caption) record.caption = feedFallback.caption;
        if (!record.takenAtUnix && feedFallback.takenAtUnix) {
          record.takenAtUnix = feedFallback.takenAtUnix;
          record.takenAtIso = feedFallback.takenAtIso;
        }
        if ((!record.username || record.username === opts.username) && feedFallback.username) {
          record.username = feedFallback.username;
          record.username_source = "feed_fallback";
        }
        const mergedImages = [...record.imageUrls, ...feedFallback.imageUrls];
        const mergedVideos = [...record.videoUrls, ...feedFallback.videoUrls];
        const hadVideoBefore = record.videoUrls.length > 0;
        record.imageUrls = [...new Set(mergedImages.filter(Boolean))];
        record.videoUrls = [...new Set(mergedVideos.filter(Boolean))];
        if (record.videoUrls.length > 0 && feedFallback.videoUrls.length > 0) {
          record.video_source = appendSourceLabel(
            hadVideoBefore ? record.video_source : "",
            "feed_fallback",
          );
        }
        log.info(
          `single_url_feed_fallback_merged shortcode=${record.shortcode} images=${record.imageUrls.length} videos=${record.videoUrls.length}`,
        );
      }
    }

    const beforeReduceVideoCount = record.videoUrls.length;
    record.videoUrls = reduceVideoUrlsForUpload(record.videoUrls);
    if (beforeReduceVideoCount !== record.videoUrls.length) {
      log.info(
        `single_url_video_urls_reduced shortcode=${record.shortcode ?? "n/a"} before=${beforeReduceVideoCount} after=${record.videoUrls.length}`,
      );
    }
    if (record.videoUrls.length === 0) {
      record.video_source = record.likelyVideo ? "missing_likely_video" : "none";
    }

    if (!opts.outputPathProvided) {
      const routedUsername = typeof record.username === "string" ? record.username.trim() : "";
      if (!routedUsername) {
        throw new Error(
          "Could not resolve post owner username for single-url. Re-run auth/headful or pass --username <owner> or --output <path>.",
        );
      }
      opts.outputPath = path.join(DEFAULT_DATA_DIR, `${routedUsername}.ndjson`);
      log.info(`single_url_output_auto_routed username=${routedUsername} output=${opts.outputPath}`);
    }

    log.success(
      `single_url_record_ready shortcode=${record.shortcode ?? "n/a"} images=${record.imageUrls.length} videos=${record.videoUrls.length}`,
    );
    log.info(
      `single_url_sources username_source=${record.username_source ?? "unknown"} video_source=${record.video_source ?? "unknown"}`,
    );

    let cloudflareImagePushOk = 0;
    let cloudflareImageAlreadyExists = 0;
    let cloudflareImagePushFail = 0;
    let cloudflareVideoPushOk = 0;
    let cloudflareVideoPushFail = 0;

    if (opts.pushCloudflare) {
      const sourcePageUrl = record.permalink || opts.instagramUrl;
      const uploadTags = buildInstagramUploadTags(record.username || opts.username, profileUsername);

      const shouldTreatAsVideoPost =
        record.mediaType === 2 ||
        record.productType === "clips" ||
        record.likelyVideo === true ||
        parsedInputUrl?.kind === "reel" ||
        parsedInputUrl?.kind === "reels" ||
        parsedInputUrl?.kind === "tv";

      if (shouldTreatAsVideoPost && record.imageUrls.length > 0) {
        log.trace(
          `cloudflare_image_skip_video_post shortcode=${record.shortcode ?? "n/a"} media_type=${record.mediaType} likely_video=${record.likelyVideo === true} product_type=${record.productType ?? "n/a"} images=${record.imageUrls.length}`,
        );
      } else {
        for (const imageUrl of record.imageUrls) {
          try {
            const pushed = await pushImageToCloudflare({
              apiBase: opts.apiBase,
              imageUrl,
              username: record.username || opts.username,
              uploadTags,
              shortcode: record.shortcode,
              permalink: record.permalink,
              sourcePageUrl,
              namespace: opts.namespace,
              log,
            });
            record.cloudflare.push({
              assetType: "image",
              imageUrl,
              ok: true,
              tags: uploadTags,
              alreadyExists: pushed.alreadyExists === true,
              id: pushed.id ?? null,
              url: pushed.url ?? null,
              variants: pushed.variants ?? [],
              duplicateIds: pushed.duplicateIds ?? [],
            });
            if (pushed.alreadyExists) cloudflareImageAlreadyExists += 1;
            else cloudflareImagePushOk += 1;
          } catch (err) {
            cloudflareImagePushFail += 1;
            record.cloudflare.push({
              assetType: "image",
              imageUrl,
              ok: false,
              tags: uploadTags,
              error: err.message,
            });
            log.warn(
              `cloudflare_push_failed shortcode=${record.shortcode ?? "n/a"} image=${imageUrl} err=${err.message}`,
            );
          }
          if (opts.requestDelayMs > 0) await sleep(opts.requestDelayMs);
        }
      }

      if (opts.skipVideoPush && record.videoUrls.length > 0) {
        log.trace(
          `cloudflare_video_skip shortcode=${record.shortcode ?? "n/a"} reason=skip_video_push urls=${record.videoUrls.length}`,
        );
      } else {
        for (const videoUrl of record.videoUrls) {
          try {
            const pushed = await pushVideoToCloudflare({
              apiBase: opts.apiBase,
              videoUrl,
              username: record.username || opts.username,
              uploadTags,
              shortcode: record.shortcode,
              permalink: record.permalink,
              sourcePageUrl,
              namespace: opts.namespace,
              log,
            });
            cloudflareVideoPushOk += 1;
            record.cloudflare.push({
              assetType: "video",
              videoUrl,
              ok: true,
              tags: uploadTags,
              id: pushed.id,
              streamUid: pushed.streamUid,
              playbackUrl: pushed.playbackUrl,
              hlsUrl: pushed.hlsUrl,
              thumbnailUrl: pushed.thumbnailUrl,
              previewUrl: pushed.previewUrl,
            });
          } catch (err) {
            cloudflareVideoPushFail += 1;
            record.cloudflare.push({
              assetType: "video",
              videoUrl,
              ok: false,
              tags: uploadTags,
              error: err.message,
            });
            log.warn(
              `cloudflare_video_push_failed shortcode=${record.shortcode ?? "n/a"} video=${videoUrl} err=${err.message}`,
            );
          }
          if (opts.requestDelayMs > 0) await sleep(opts.requestDelayMs);
        }
      }

      if (shouldTreatAsVideoPost && record.videoUrls.length === 0) {
        log.warn(
          `cloudflare_video_missing shortcode=${record.shortcode ?? "n/a"} likely_video=true media_type=${record.mediaType ?? "n/a"} product_type=${record.productType ?? "n/a"} no videoUrls recovered; skipped thumbnail image upload`,
        );
      }

      log.success(
        `single_url_cloudflare images_uploaded=${cloudflareImagePushOk} images_exists=${cloudflareImageAlreadyExists} images_failed=${cloudflareImagePushFail} videos_uploaded=${cloudflareVideoPushOk} videos_failed=${cloudflareVideoPushFail}`,
      );
    }

    await ensureParentDir(opts.outputPath);
    await fsp.appendFile(opts.outputPath, `${JSON.stringify(record)}\n`, "utf8");
    log.success(`single_url_record_written output=${opts.outputPath}`);
    log.success(`single_url_complete output=${opts.outputPath}`);
  } finally {
    await browser.close();
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const log = createLogger(opts);

  if (opts.command === "help" || opts.command === "--help" || opts.command === "-h") {
    printUsage();
    return;
  }

  if (!Number.isFinite(opts.count) || opts.count <= 0) throw new Error("--count must be a positive integer.");
  if (!Number.isFinite(opts.maxPages) || opts.maxPages < 0) throw new Error("--max-pages must be >= 0.");
  if (!Number.isFinite(opts.delayMs) || opts.delayMs < 0) throw new Error("--delay-ms must be >= 0.");
  if (!Number.isFinite(opts.requestDelayMs) || opts.requestDelayMs < 0) {
    throw new Error("--request-delay-ms must be >= 0.");
  }

  if (opts.command === "auth") {
    if (!opts.username || !opts.username.trim()) {
      throw new Error("auth requires --username <name>");
    }
    await runAuth(opts, log);
    return;
  }
  if (opts.command === "ingest") {
    if (!opts.username || !opts.username.trim()) {
      throw new Error("ingest requires --username <name>");
    }
    await runIngest(opts, log);
    return;
  }
  if (opts.command === "single-url") {
    await runSingleUrl(opts, log);
    return;
  }
  if (opts.command === "videos-from-ndjson") {
    if ((!opts.username || !opts.username.trim()) && !opts.inputPathProvided) {
      throw new Error("videos-from-ndjson requires --username <name> (or pass --input <path>)");
    }
    await runVideosFromNdjson(opts, log);
    return;
  }

  printUsage();
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(`${C.red}${err.message}${C.reset}`);
  process.exitCode = 1;
});
