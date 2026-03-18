#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const DEFAULT_API_BASE = "http://localhost:3000";
const DEFAULT_NAMESPACE = "cf-default";
const DEFAULT_REQUEST_DELAY_MS = 800;
const DEFAULT_PROFILE_DIR = path.resolve(".cache/instagram-profile");

function printUsage() {
  console.log(`Instagram Video Recovery Helper

Resolve missing Instagram video URLs in NDJSON, then replay video uploads.

Usage:
  node scripts/instagram-video-recover.mjs --input <path> --namespace <name> [options]

Options:
  --input <path>            NDJSON file to repair and replay (required)
  --namespace <name>        Target namespace for replay upload (default: ${DEFAULT_NAMESPACE})
  --api-base <url>          Local API base (default: ${DEFAULT_API_BASE})
  --request-delay-ms <n>    Delay between replay pushes (default: ${DEFAULT_REQUEST_DELAY_MS})
  --profile-dir <path>      Chromium profile for ig:url resolve step (default: ${DEFAULT_PROFILE_DIR})
  --username <name>         Fallback owner username for unresolved records
  --limit <n>               Resolve at most N missing shortcodes
  --headful                 Run ig:url resolve step in headed browser mode
  --skip-resolve            Skip URL resolution and run replay only
  --skip-replay             Skip replay and run resolve only
  --dry-run                 Print commands without executing
  -v, --verbose             Print per-shortcode resolution details
  -h, --help                Show this help

Examples:
  node scripts/instagram-video-recover.mjs --input data/instagram/darthjulian.ndjson --namespace ig-videos
  node scripts/instagram-video-recover.mjs --input data/instagram/darthjulian.ndjson --namespace ig-videos --headful --limit 5
`);
}

function parseArgs(argv) {
  const out = {
    input: "",
    namespace: DEFAULT_NAMESPACE,
    apiBase: DEFAULT_API_BASE,
    requestDelayMs: DEFAULT_REQUEST_DELAY_MS,
    profileDir: DEFAULT_PROFILE_DIR,
    username: "",
    limit: 0,
    headful: false,
    skipResolve: false,
    skipReplay: false,
    dryRun: false,
    verbose: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--input" && next) {
      out.input = path.resolve(next);
      i += 1;
    } else if (arg === "--namespace" && next) {
      out.namespace = next.trim();
      i += 1;
    } else if (arg === "--api-base" && next) {
      out.apiBase = next.trim().replace(/\/+$/, "");
      i += 1;
    } else if (arg === "--request-delay-ms" && next) {
      out.requestDelayMs = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === "--profile-dir" && next) {
      out.profileDir = path.resolve(next);
      i += 1;
    } else if (arg === "--username" && next) {
      out.username = next.trim();
      i += 1;
    } else if (arg === "--limit" && next) {
      out.limit = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === "--headful") {
      out.headful = true;
    } else if (arg === "--skip-resolve") {
      out.skipResolve = true;
    } else if (arg === "--skip-replay") {
      out.skipReplay = true;
    } else if (arg === "--dry-run") {
      out.dryRun = true;
    } else if (arg === "-v" || arg === "--verbose") {
      out.verbose = true;
    } else if (arg === "-h" || arg === "--help") {
      out.help = true;
    }
  }

  return out;
}

function cleanUsername(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
}

function inferShortcodeFromPermalink(permalink) {
  if (typeof permalink !== "string" || !permalink.trim()) return null;
  try {
    const parsed = new URL(permalink);
    const parts = parsed.pathname.split("/").filter(Boolean);
    for (let i = 0; i < parts.length - 1; i += 1) {
      const kind = (parts[i] || "").toLowerCase();
      if (kind === "p" || kind === "reel" || kind === "reels" || kind === "tv") {
        return parts[i + 1] || null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function hasVideoUrls(record) {
  if (Array.isArray(record?.videoUrls) && record.videoUrls.some((url) => typeof url === "string" && url.trim())) {
    return true;
  }
  if (typeof record?.videoUrl === "string" && record.videoUrl.trim()) return true;
  if (Array.isArray(record?.video_urls) && record.video_urls.some((url) => typeof url === "string" && url.trim())) {
    return true;
  }
  if (Array.isArray(record?.cloudflare)) {
    return record.cloudflare.some(
      (asset) => asset?.assetType === "video" && typeof asset?.videoUrl === "string" && asset.videoUrl.trim(),
    );
  }
  return false;
}

function buildResolveCandidates(records, fallbackUsername) {
  const byShortcode = new Map();
  for (const record of records) {
    const likelyVideo = record?.likelyVideo === true;
    if (!likelyVideo) continue;
    if (hasVideoUrls(record)) continue;

    const shortcode = record?.shortcode || inferShortcodeFromPermalink(record?.permalink);
    if (!shortcode) continue;

    const profileUsername = cleanUsername(record?.profileUsername);
    const recordUsername = cleanUsername(record?.username);
    const chosenUsername = profileUsername || recordUsername || cleanUsername(fallbackUsername);
    const permalink =
      typeof record?.permalink === "string" && record.permalink.trim()
        ? record.permalink.trim()
        : `https://www.instagram.com/p/${shortcode}/`;

    if (!byShortcode.has(shortcode)) {
      byShortcode.set(shortcode, {
        shortcode,
        permalink,
        username: chosenUsername,
      });
    }
  }
  return [...byShortcode.values()];
}

function runNodeScript(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed: node ${args.join(" ")} (exit ${code})`));
    });
  });
}

async function loadNdjson(inputPath) {
  const raw = await fs.readFile(inputPath, "utf8");
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const out = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line));
    } catch {
      // ignore malformed lines so helper can still proceed
    }
  }
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printUsage();
    return;
  }
  if (!opts.input) throw new Error("--input <path> is required");
  if (!Number.isFinite(opts.requestDelayMs) || opts.requestDelayMs < 0) {
    throw new Error("--request-delay-ms must be >= 0");
  }
  if (!Number.isFinite(opts.limit) || opts.limit < 0) throw new Error("--limit must be >= 0");
  if (!opts.skipReplay && (opts.namespace === "__all__" || opts.namespace === "__none__")) {
    throw new Error('Invalid --namespace. Use a specific namespace, not "__all__" or "__none__".');
  }

  const records = await loadNdjson(opts.input);
  const candidates = buildResolveCandidates(records, opts.username);
  const selected = opts.limit > 0 ? candidates.slice(0, opts.limit) : candidates;

  console.log(`input=${opts.input}`);
  console.log(`records_loaded=${records.length}`);
  console.log(`missing_likely_video_shortcodes=${candidates.length}`);
  if (!opts.skipResolve) {
    console.log(`resolve_targets=${selected.length}`);
  }

  if (!opts.skipResolve) {
    for (const candidate of selected) {
      const args = [
        "scripts/instagram-ingest.mjs",
        "single-url",
        "--url",
        candidate.permalink,
        "--output",
        opts.input,
        "--profile-dir",
        opts.profileDir,
      ];
      if (candidate.username) {
        args.push("--username", candidate.username);
      }
      if (opts.headful) args.push("--headful");

      if (opts.verbose || opts.dryRun) {
        console.log(
          `[resolve] shortcode=${candidate.shortcode} username=${candidate.username || "(none)"} url=${candidate.permalink}`,
        );
      }
      if (opts.dryRun) {
        console.log(`[dry-run] node ${args.join(" ")}`);
      } else {
        await runNodeScript(args);
      }
    }
  }

  if (!opts.skipReplay) {
    const replayArgs = [
      "scripts/instagram-ingest.mjs",
      "videos-from-ndjson",
      "--input",
      opts.input,
      "--namespace",
      opts.namespace,
      "--api-base",
      opts.apiBase,
      "--request-delay-ms",
      String(opts.requestDelayMs),
    ];
    if (opts.username) replayArgs.push("--username", cleanUsername(opts.username));

    if (opts.dryRun) {
      console.log(`[dry-run] node ${replayArgs.join(" ")}`);
    } else {
      await runNodeScript(replayArgs);
    }
  }

  if (opts.dryRun) console.log("dry_run_complete=true");
}

main().catch((err) => {
  console.error(err.message || String(err));
  process.exitCode = 1;
});
