import path from "node:path";

export const APP_ID = "936619743392459";
export const DEFAULT_USERNAME = "";
export const DEFAULT_PROFILE_DIR = path.resolve(".cache/instagram-profile");
export const DEFAULT_DATA_DIR = path.resolve("data/instagram");
const DEFAULT_VERBOSITY = 5;

export const C = {
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

export function normalizeInstagramUsername(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  let candidate = raw;
  try {
    const parsed = new URL(raw);
    if (/instagram\.com$/i.test(parsed.hostname) || /\.instagram\.com$/i.test(parsed.hostname)) {
      candidate = parsed.pathname;
    }
  } catch {
    // Plain handles are the common path; URL parsing is only for profile URLs.
  }

  const withoutAt = candidate.replace(/^@+/, "");
  const pathSegment = withoutAt
    .split(/[/?#]/)
    .map((part) => part.trim())
    .filter(Boolean)[0] || "";
  return pathSegment.replace(/^@+/, "");
}

function nowStamp() {
  return new Date().toISOString();
}

function colorize(color, text, noColor = false) {
  if (noColor) return text;
  return `${color}${text}${C.reset}`;
}

export function createLogger(opts) {
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

export function printUsage() {
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
  --ai-display-name         Generate display names for image uploads during ingest
  --skip-video-push         Skip pushing videos during ingest
  --api-base <url>          Base URL for local API (default: http://localhost:3000)
  --namespace <name>        Upload namespace (default: ingest; single-url default: cf-instagram)
  --no-resume               Ignore existing checkpoint and start from newest page
  --headful                 Run ingest with visible browser window
  -v, --verbose             Increase verbosity (stackable)
  --quiet                   Minimal logging
  --no-color                Disable ANSI colors
  --help                    Show this help
`);
}

export function parseArgs(argv) {
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
    aiDisplayName: false,
    skipVideoPush: false,
    apiBase: "http://localhost:3000",
    namespace: "ingest",
    namespaceProvided: false,
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
      out.username = normalizeInstagramUsername(next);
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
      out.namespaceProvided = true;
      i += 1;
    } else if (arg === "--push-cloudflare") out.pushCloudflare = true;
    else if (arg === "--no-push-cloudflare") out.pushCloudflare = false;
    else if (arg === "--ai-display-name") out.aiDisplayName = true;
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
  if (out.command === "single-url" && !out.namespaceProvided) {
    out.namespace = "cf-instagram";
  }

  return out;
}
