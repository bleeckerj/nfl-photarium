#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import exifReader from "exif-reader";

const execFileAsync = promisify(execFile);

const RAW_DNG_EXTENSIONS = new Set([".dng"]);
const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".bmp",
  ".tif",
  ".tiff",
  ".avif",
  ".dng",
]);
const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".webm",
  ".mov",
  ".m4v",
  ".ogv",
  ".ogg",
]);

const MIME_BY_EXTENSION = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".avif": "image/avif",
  ".dng": "image/x-adobe-dng",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/mp4",
  ".ogv": "video/ogg",
  ".ogg": "video/ogg",
};

const supportsColor = (() => {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR === "0") return false;
  if (process.env.FORCE_COLOR) return true;
  return Boolean(process.stdout.isTTY);
})();

const color = {
  dim: (s) => (supportsColor ? `\x1b[2m${s}\x1b[0m` : s),
  cyan: (s) => (supportsColor ? `\x1b[36m${s}\x1b[0m` : s),
  blue: (s) => (supportsColor ? `\x1b[34m${s}\x1b[0m` : s),
  magenta: (s) => (supportsColor ? `\x1b[35m${s}\x1b[0m` : s),
  yellow: (s) => (supportsColor ? `\x1b[33m${s}\x1b[0m` : s),
  green: (s) => (supportsColor ? `\x1b[32m${s}\x1b[0m` : s),
  red: (s) => (supportsColor ? `\x1b[31m${s}\x1b[0m` : s),
  bold: (s) => (supportsColor ? `\x1b[1m${s}\x1b[0m` : s),
  white: (s) => (supportsColor ? `\x1b[97m${s}\x1b[0m` : s),
};

function kv(label, value, labelColor = color.cyan, valueColor = color.white) {
  return `${labelColor(label)}=${valueColor(String(value))}`;
}

function printUsage() {
  console.log(`Media Filesystem Ingest CLI

Usage:
  node scripts/dng-ingest.mjs --root <dir> --namespace <name> [options]
  npm run media:ingest -- --root <dir> --namespace <name> [options]

Required:
  --root <dir>                Root directory to recursively scan for media files
  --namespace <name>          Target namespace (required)

Options:
  --api-base <url>            API base URL (default: http://localhost:3000)
  --checkpoint-file <path>    Override checkpoint file path
  --folder <name>             Optional folder value for uploaded assets
  --tags <csv>                Base tags to apply to every file
  --append-image-tag <tag>    Optional tag appended to image tags (after AI tags)
  --description-prefix <txt>  Prefix text prepended to description
  --include-filename          Include filename in description
  --include-path-tags         Add subdirectory names as tags
  --ai-metadata               Generate tags with AI (displayName is preserved by default)
  --ai-display-name           Generate displayName only (from preview)
  --ai-tags                   Generate tags only (from preview)
  --tag-count <n>             AI tag count target (default: 4)
  --preview-max <px|2k|4k|original>  Max DNG preview dimension (default: original)
  --preview-format <fmt>      Preview format: webp|jpeg (default: jpeg, DNG conversion uses jpeg)
  --preview-quality <n>       Preview quality 1-100 (default: 90)
  --jpeg-quality <n>          Preview JPEG quality 1-100 (default: 90)
  --concurrency <n>           Parallel workers (default: 2)
  --throttle-ms <n>           Minimum delay between upload requests (default: 0)
  --limit <n>                 Stop after N matching files
  --no-embeddings             Do not call /api/images/:id/embeddings after upload
  --dry-run                   Print planned uploads without uploading
  --no-timestamps             Disable per-line log timestamps (enabled by default)
  --verbose                   More logging (default on)
  --quiet                     Minimal logging
  --help                      Show this help

Examples:
  npm run media:ingest -- --root ~/Photos --namespace archive --ai-metadata --tag-count 4
  npm run media:ingest -- --root ~/Photos/RAW --namespace archive --checkpoint-file ./data/dng-shared.json --include-path-tags
`);
}

function expandHome(inputPath) {
  if (!inputPath) return inputPath;
  if (inputPath === "~") return os.homedir();
  if (inputPath.startsWith("~/")) return path.join(os.homedir(), inputPath.slice(2));
  return inputPath;
}

function parseArgs(argv) {
  const opts = {
    root: "",
    namespace: "",
    apiBase: "http://localhost:3000",
    checkpointFile: "",
    folder: "",
    tagsCsv: "",
    appendImageTag: "",
    descriptionPrefix: "",
    includeFilename: false,
    includePathTags: false,
    aiMetadata: false,
    aiDisplayName: false,
    aiTags: false,
    tagCount: 4,
    previewMax: "original",
    previewFormat: "jpeg",
    previewQuality: 90,
    jpegQuality: 90,
    concurrency: 2,
    throttleMs: 0,
    limit: 0,
    ensureEmbeddings: true,
    dryRun: false,
    timestamps: true,
    verbose: true,
    help: false,
  };
  const errors = [];

  function requireValue(flag, value) {
    if (!value || value.startsWith("--")) {
      errors.push(`Missing value for ${flag}`);
      return false;
    }
    return true;
  }

  function unknownFlagMessage(flag) {
    if (flag.startsWith("--namesp")) {
      return `Unknown option: ${flag} (did you mean --namespace?)`;
    }
    return `Unknown option: ${flag}`;
  }

  function parseDimensionToken(raw) {
    const token = String(raw || "").trim().toLowerCase();
    if (token === "original" || token === "full" || token === "source") return "original";
    const match = token.match(/^(\d+)(k)?$/);
    if (!match) return Number.NaN;
    const base = Number.parseInt(match[1], 10);
    if (!Number.isFinite(base) || base < 1) return Number.NaN;
    return match[2] ? base * 1024 : base;
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else if (arg === "--root") {
      if (!requireValue(arg, next)) continue;
      opts.root = path.resolve(expandHome(next));
      i += 1;
    } else if (arg === "--namespace") {
      if (!requireValue(arg, next)) continue;
      opts.namespace = next.trim();
      i += 1;
    } else if (arg === "--api-base") {
      if (!requireValue(arg, next)) continue;
      opts.apiBase = next.trim().replace(/\/+$/, "");
      i += 1;
    } else if (arg === "--checkpoint-file") {
      if (!requireValue(arg, next)) continue;
      opts.checkpointFile = path.resolve(expandHome(next));
      i += 1;
    } else if (arg === "--folder") {
      if (!requireValue(arg, next)) continue;
      opts.folder = next.trim();
      i += 1;
    } else if (arg === "--tags") {
      if (!requireValue(arg, next)) continue;
      opts.tagsCsv = next;
      i += 1;
    } else if (arg === "--append-image-tag") {
      if (!requireValue(arg, next)) continue;
      opts.appendImageTag = next;
      i += 1;
    } else if (arg === "--description-prefix") {
      if (!requireValue(arg, next)) continue;
      opts.descriptionPrefix = next;
      i += 1;
    } else if (arg === "--tag-count") {
      if (!requireValue(arg, next)) continue;
      opts.tagCount = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === "--preview-max") {
      if (!requireValue(arg, next)) continue;
      opts.previewMax = parseDimensionToken(next);
      i += 1;
    } else if (arg === "--jpeg-quality") {
      if (!requireValue(arg, next)) continue;
      opts.jpegQuality = Number.parseInt(next, 10);
      opts.previewQuality = opts.jpegQuality;
      i += 1;
    } else if (arg === "--preview-quality") {
      if (!requireValue(arg, next)) continue;
      opts.previewQuality = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === "--preview-format") {
      if (!requireValue(arg, next)) continue;
      opts.previewFormat = String(next || "").trim().toLowerCase();
      i += 1;
    } else if (arg === "--concurrency") {
      if (!requireValue(arg, next)) continue;
      opts.concurrency = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === "--throttle-ms") {
      if (!requireValue(arg, next)) continue;
      opts.throttleMs = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === "--limit") {
      if (!requireValue(arg, next)) continue;
      opts.limit = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === "--include-filename") {
      opts.includeFilename = true;
    } else if (arg === "--include-path-tags") {
      opts.includePathTags = true;
    } else if (arg === "--ai-metadata") {
      opts.aiMetadata = true;
    } else if (arg === "--ai-display-name") {
      opts.aiDisplayName = true;
    } else if (arg === "--ai-tags") {
      opts.aiTags = true;
    } else if (arg === "--no-embeddings") {
      opts.ensureEmbeddings = false;
    } else if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--no-timestamps") {
      opts.timestamps = false;
    } else if (arg === "--verbose") {
      opts.verbose = true;
    } else if (arg === "--quiet") {
      opts.verbose = false;
    } else if (arg.startsWith("-")) {
      errors.push(unknownFlagMessage(arg));
    } else {
      errors.push(`Unexpected positional argument: ${arg}`);
    }
  }

  if (opts.aiMetadata) {
    // DNG ingest preserves indexical filenames unless explicitly requested.
    opts.aiTags = true;
  }
  if (!Number.isFinite(opts.tagCount) || opts.tagCount < 1) opts.tagCount = 4;
  if (opts.previewMax !== "original" && (!Number.isFinite(opts.previewMax) || opts.previewMax < 256)) {
    opts.previewMax = "original";
  }
  if (!["webp", "jpeg", "jpg"].includes(opts.previewFormat)) opts.previewFormat = "jpeg";
  if (opts.previewFormat === "jpg") opts.previewFormat = "jpeg";
  if (!Number.isFinite(opts.previewQuality) || opts.previewQuality < 1 || opts.previewQuality > 100) opts.previewQuality = 90;
  if (!Number.isFinite(opts.jpegQuality) || opts.jpegQuality < 1 || opts.jpegQuality > 100) opts.jpegQuality = 90;
  if (!Number.isFinite(opts.concurrency) || opts.concurrency < 1) opts.concurrency = 2;
  if (!Number.isFinite(opts.throttleMs) || opts.throttleMs < 0) opts.throttleMs = 0;
  if (!Number.isFinite(opts.limit) || opts.limit < 0) opts.limit = 0;
  if (!opts.aiDisplayName && !opts.aiTags) {
    opts.aiTags = true;
  }
  return { ...opts, errors };
}

function timestampPrefix() {
  return `[${new Date().toISOString()}]`;
}

function initTimestampedLogging(enabled) {
  if (!enabled) return;
  const log = console.log.bind(console);
  const warn = console.warn.bind(console);
  const error = console.error.bind(console);

  console.log = (...args) => log(timestampPrefix(), ...args);
  console.warn = (...args) => warn(timestampPrefix(), ...args);
  console.error = (...args) => error(timestampPrefix(), ...args);
}

function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function uniqueStrings(items) {
  return Array.from(new Set(items.map((s) => s.trim()).filter(Boolean)));
}

function normalizeTag(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/[^\w\s-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mergeTagsWithOptionalTail(base, tail, limit = 12) {
  const merged = uniqueStrings(base).slice(0, Math.max(0, limit));
  const extra = String(tail || "").trim();
  if (!extra) return merged;
  if (merged.includes(extra)) return merged;
  if (merged.length < limit) return [...merged, extra];
  return [...merged.slice(0, Math.max(0, limit - 1)), extra];
}

function stablePathKey(rootDir, namespace) {
  return createHash("sha1")
    .update(`${path.resolve(rootDir)}\n${namespace}`)
    .digest("hex")
    .slice(0, 16);
}

function defaultCheckpointPath(rootDir, namespace) {
  const key = stablePathKey(rootDir, namespace);
  return path.resolve("data", "dng-ingest-checkpoints", `${key}.json`);
}

function fileSignatureFromStat(stat) {
  return `${stat.size}:${Math.trunc(stat.mtimeMs)}`;
}

function checkpointHashKey({ namespace, kind, contentHash }) {
  return `${namespace}\n${kind}\n${contentHash}`;
}

async function loadCheckpoint(checkpointPath) {
  try {
    const raw = await fs.readFile(checkpointPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { version: 2, entries: {}, hashEntries: {} };
    const entries = parsed.entries && typeof parsed.entries === "object" ? parsed.entries : {};
    const hashEntries = parsed.hashEntries && typeof parsed.hashEntries === "object" ? parsed.hashEntries : {};
    return { version: 2, entries, hashEntries };
  } catch {
    return { version: 2, entries: {}, hashEntries: {} };
  }
}

async function saveCheckpoint(checkpointPath, checkpoint) {
  await fs.mkdir(path.dirname(checkpointPath), { recursive: true });
  const tmpPath = `${checkpointPath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(checkpoint, null, 2), "utf8");
  await fs.rename(tmpPath, checkpointPath);
}

function createSerializedTaskQueue() {
  let chain = Promise.resolve();
  return async (task) => {
    const next = chain.then(task);
    chain = next.catch(() => {});
    return next;
  };
}

async function walkMediaFiles(rootDir, { limit = 0 } = {}) {
  const out = [];
  const queue = [rootDir];
  while (queue.length > 0) {
    const dir = queue.shift();
    if (!dir) continue;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name === ".DS_Store") continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".")) continue;
        queue.push(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(ext) && !VIDEO_EXTENSIONS.has(ext)) continue;
      const kind = VIDEO_EXTENSIONS.has(ext) ? "video" : "image";
      out.push({ path: abs, kind });
      if (limit > 0 && out.length >= limit) return out;
    }
  }
  return out;
}

function buildDescription({
  relDir,
  filename,
  relPath,
  absolutePath,
  descriptionPrefix,
  includeFilename,
}) {
  const parts = [];
  if (descriptionPrefix) parts.push(descriptionPrefix.trim());
  if (relDir && relDir !== ".") parts.push(`Subdirectories: ${relDir}`);
  if (includeFilename) parts.push(`Filename: ${filename}`);
  parts.push(`Raw source: local://${absolutePath.split(path.sep).join("/")}`);
  if (relPath) parts.push(`Relative source: local://${relPath.split(path.sep).join("/")}`);
  return parts.join(" | ").trim() || undefined;
}

async function hashFileContent(filePath) {
  const bytes = await fs.readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

function safeJsonValue(value, depth = 0) {
  if (depth > 8) return undefined;
  if (value === null) return null;
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") return value;
  if (t === "bigint") return value.toString();
  if (ArrayBuffer.isView(value)) {
    return summarizeBytes(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  }
  if (Array.isArray(value)) {
    if (isByteArray(value)) {
      return summarizeBytes(Uint8Array.from(value));
    }
    return value.map((item) => safeJsonValue(item, depth + 1)).filter((item) => item !== undefined);
  }
  if (t === "object") {
    const byteObject = maybeBytesFromNumericObject(value);
    if (byteObject) {
      return summarizeBytes(byteObject);
    }
    const record = {};
    for (const [k, v] of Object.entries(value)) {
      const parsed = safeJsonValue(v, depth + 1);
      if (parsed !== undefined) record[k] = parsed;
    }
    return record;
  }
  return undefined;
}

function isByteArray(value) {
  if (!Array.isArray(value) || value.length === 0) return false;
  if (value.length > 64) return value.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255);
  const numericRatio = value.reduce((count, entry) => {
    return count + (Number.isInteger(entry) && entry >= 0 && entry <= 255 ? 1 : 0);
  }, 0) / value.length;
  return numericRatio >= 0.95;
}

function maybeBytesFromNumericObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || ArrayBuffer.isView(value)) return null;
  const keys = Object.keys(value);
  if (keys.length < 16) return null;
  if (!keys.every((key) => /^\d+$/.test(key))) return null;

  const sorted = keys.map(Number).sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i += 1) {
    if (sorted[i] !== i) return null;
  }

  const bytes = new Uint8Array(sorted.length);
  for (const idx of sorted) {
    const raw = value[idx];
    if (!Number.isInteger(raw) || raw < 0 || raw > 255) return null;
    bytes[idx] = raw;
  }
  return bytes;
}

function decodeUserComment(bytes) {
  if (bytes.length < 8) return undefined;
  const marker = String.fromCharCode(...bytes.slice(0, 8));
  const payload = bytes.slice(8);

  if (marker === "ASCII\u0000\u0000\u0000") {
    return decodeAscii(payload);
  }
  if (marker.startsWith("UNICODE")) {
    const be = decodeUtf16(payload, false);
    const le = decodeUtf16(payload, true);
    if (be && le) return be.length >= le.length ? be : le;
    return be || le || undefined;
  }
  if (marker.startsWith("JIS")) {
    return undefined;
  }
  return undefined;
}

function decodeAscii(bytes) {
  const chars = [];
  for (const b of bytes) {
    if (b === 0) break;
    chars.push(String.fromCharCode(b));
  }
  const text = chars.join("").trim();
  return text || undefined;
}

function decodeUtf16(bytes, littleEndian) {
  const evenLength = bytes.length - (bytes.length % 2);
  if (evenLength <= 0) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, evenLength);
  const codeUnits = [];
  for (let i = 0; i < evenLength; i += 2) {
    const code = view.getUint16(i, littleEndian);
    if (code === 0) break;
    if (code >= 32 || code === 9 || code === 10 || code === 13) {
      codeUnits.push(code);
    } else {
      return undefined;
    }
  }
  if (!codeUnits.length) return undefined;
  const text = String.fromCharCode(...codeUnits).trim();
  return text || undefined;
}

function decodePrintableText(bytes) {
  const trimmed = bytes.slice(0, 4096);
  const chars = [];
  let printable = 0;
  for (const b of trimmed) {
    if (b === 0) break;
    if (b >= 32 && b <= 126) {
      printable += 1;
      chars.push(String.fromCharCode(b));
      continue;
    }
    if (b === 9 || b === 10 || b === 13) {
      printable += 1;
      chars.push(String.fromCharCode(b));
      continue;
    }
    return undefined;
  }
  if (chars.length === 0) return undefined;
  if (printable / chars.length < 0.9) return undefined;
  const text = chars.join("").trim();
  return text || undefined;
}

function summarizeBytes(bytes) {
  const decodedUserComment = decodeUserComment(bytes);
  const decodedText = decodedUserComment || decodePrintableText(bytes);
  const previewBytes = Array.from(bytes.slice(0, 16)).map((b) => b.toString(16).padStart(2, "0"));

  return {
    _type: "bytes",
    length: bytes.length,
    preview_hex: previewBytes.join(" "),
    ...(decodedText ? { decoded_text: decodedText } : {}),
  };
}

function analyzeExifTree(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 8) {
    return { keys: 0, byteBlobs: 0 };
  }
  if (Array.isArray(value)) {
    return value.reduce(
      (acc, item) => {
        const next = analyzeExifTree(item, depth + 1);
        return {
          keys: acc.keys + next.keys,
          byteBlobs: acc.byteBlobs + next.byteBlobs,
        };
      },
      { keys: 0, byteBlobs: 0 }
    );
  }

  if (value._type === "bytes") {
    return { keys: 1, byteBlobs: 1 };
  }

  let keys = 0;
  let byteBlobs = 0;
  for (const [k, v] of Object.entries(value)) {
    keys += 1;
    const next = analyzeExifTree(v, depth + 1);
    keys += next.keys;
    byteBlobs += next.byteBlobs;
    if (k === "UserComment" && v && typeof v === "object" && v._type === "bytes") {
      byteBlobs += 0;
    }
  }
  return { keys, byteBlobs };
}

function buildExifLogLines(exif) {
  const lines = [];
  if (!exif || typeof exif !== "object") return lines;

  if (typeof exif.parseError === "string") {
    lines.push(`parseError: ${exif.parseError}`);
  }

  if (exif.summary && typeof exif.summary === "object" && !Array.isArray(exif.summary)) {
    const summaryEntries = Object.entries(exif.summary).slice(0, 10);
    if (summaryEntries.length) {
      const summaryText = summaryEntries
        .map(([k, v]) => `${k}=${String(v).slice(0, 120)}`)
        .join(" | ");
      lines.push(`summary: ${summaryText}`);
    }
  }

  if (exif.sharp && typeof exif.sharp === "object" && !Array.isArray(exif.sharp)) {
    const format = typeof exif.sharp.format === "string" ? exif.sharp.format : "?";
    const width = typeof exif.sharp.width === "number" ? exif.sharp.width : "?";
    const height = typeof exif.sharp.height === "number" ? exif.sharp.height : "?";
    const depth = typeof exif.sharp.depth === "string" ? exif.sharp.depth : "?";
    lines.push(`sharp: format=${format} dimensions=${width}x${height} depth=${depth}`);
  }

  if (exif.parsed && typeof exif.parsed === "object" && !Array.isArray(exif.parsed)) {
    const sections = Object.keys(exif.parsed);
    const stats = analyzeExifTree(exif.parsed);
    lines.push(
      `parsed: sections=${sections.length} keys=${stats.keys} byteBlobs=${stats.byteBlobs} (${sections.slice(0, 8).join(", ")}${sections.length > 8 ? ", ..." : ""})`
    );
  }

  if (!lines.length) {
    const raw = JSON.stringify(exif);
    lines.push(raw.length > 400 ? `${raw.slice(0, 400)}...` : raw);
  }
  return lines;
}

function formatExifValue(value) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string" || typeof value === "number") return value;
  if (Array.isArray(value)) {
    const cleaned = value.map((entry) => formatExifValue(entry)).filter(Boolean);
    return cleaned.length ? cleaned.join(", ") : undefined;
  }
  if (typeof value === "object") {
    if (
      Object.prototype.hasOwnProperty.call(value, "numerator") &&
      Object.prototype.hasOwnProperty.call(value, "denominator") &&
      typeof value.numerator === "number" &&
      typeof value.denominator === "number" &&
      value.denominator !== 0
    ) {
      return `${value.numerator}/${value.denominator}`;
    }
    const asString = value.toString?.();
    return asString && asString !== "[object Object]" ? asString : undefined;
  }
  return undefined;
}

function addExif(summary, key, value) {
  const formatted = formatExifValue(value);
  if (formatted !== undefined && formatted !== "") summary[key] = formatted;
}

async function extractExifDetails(filePath) {
  try {
    const metadata = await sharp(filePath, { limitInputPixels: false }).metadata();
    let parsedExif;
    if (metadata.exif) {
      parsedExif = exifReader(metadata.exif);
    }
    const summary = {};
    addExif(summary, "make", parsedExif?.Image?.Make);
    addExif(summary, "model", parsedExif?.Image?.Model);
    addExif(summary, "lens", parsedExif?.Photo?.LensModel || parsedExif?.Photo?.LensSpecification);
    addExif(summary, "dateTimeOriginal", parsedExif?.Photo?.DateTimeOriginal);
    addExif(summary, "exposureTime", parsedExif?.Photo?.ExposureTime);
    addExif(summary, "fNumber", parsedExif?.Photo?.FNumber);
    addExif(summary, "iso", parsedExif?.Photo?.ISOSpeedRatings || parsedExif?.Photo?.PhotographicSensitivity);
    addExif(summary, "focalLength", parsedExif?.Photo?.FocalLength);

    const sharpSummary = safeJsonValue({
      format: metadata.format,
      width: metadata.width,
      height: metadata.height,
      space: metadata.space,
      channels: metadata.channels,
      depth: metadata.depth,
      density: metadata.density,
      hasAlpha: metadata.hasAlpha,
      orientation: metadata.orientation,
      isProgressive: metadata.isProgressive,
      pages: metadata.pages,
      pagePrimary: metadata.pagePrimary,
      compression: metadata.compression,
      resolutionUnit: metadata.resolutionUnit,
    });

    const out = {};
    if (Object.keys(summary).length > 0) out.summary = summary;
    if (parsedExif) out.parsed = safeJsonValue(parsedExif);
    if (sharpSummary && Object.keys(sharpSummary).length > 0) out.sharp = sharpSummary;
    return Object.keys(out).length > 0 ? out : undefined;
  } catch (error) {
    return { parseError: error instanceof Error ? error.message : String(error) };
  }
}

async function createPreviewBuffer(filePath, { previewMax, previewFormat, quality }) {
  try {
    let pipeline = sharp(filePath, { limitInputPixels: false })
      .rotate();

    if (previewMax !== "original") {
      pipeline = pipeline.resize({
        width: previewMax,
        height: previewMax,
        fit: "inside",
        withoutEnlargement: true,
      });
    }

    if (previewFormat === "webp") {
      pipeline = pipeline.webp({ quality });
    } else {
      pipeline = pipeline.jpeg({ quality, mozjpeg: true });
    }

    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    return {
      buffer: data,
      width: info.width,
      height: info.height,
      size: data.byteLength,
      method: "sharp",
      format: previewFormat,
      mime: previewFormat === "webp" ? "image/webp" : "image/jpeg",
    };
  } catch (sharpError) {
    const tmpDir = path.resolve("tmp", "dng-ingest-previews");
    await fs.mkdir(tmpDir, { recursive: true });
    const tmpOut = path.join(tmpDir, `${createHash("sha1").update(filePath).digest("hex").slice(0, 16)}.jpg`);
    try {
      await execFileAsync("sips", [
        "-s", "format", "jpeg",
        ...(previewMax === "original" ? [] : ["--resampleHeightWidthMax", String(previewMax)]),
        filePath,
        "--out", tmpOut,
      ]);
      const data = await fs.readFile(tmpOut);
      if (previewFormat === "webp") {
        const { data: webpData, info: webpInfo } = await sharp(data).webp({ quality }).toBuffer({ resolveWithObject: true });
        return {
          buffer: webpData,
          width: webpInfo.width,
          height: webpInfo.height,
          size: webpData.byteLength,
          method: "sips+sharp",
          format: "webp",
          mime: "image/webp",
        };
      }
      const info = await sharp(data).metadata();
      return {
        buffer: data,
        width: info.width,
        height: info.height,
        size: data.byteLength,
        method: "sips",
        format: "jpeg",
        mime: "image/jpeg",
      };
    } catch (fallbackError) {
      throw new Error(
        `Preview generation failed (sharp: ${
          sharpError instanceof Error ? sharpError.message : String(sharpError)
        }; sips: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)})`
      );
    }
  }
}

async function suggestAiMetadata({
  apiBase,
  previewBuffer,
  previewMime,
  filename,
  folder,
  existingTags,
  wantDisplayName,
  wantTags,
  tagCount,
}) {
  const form = new FormData();
  form.append("file", new Blob([previewBuffer], { type: previewMime || "image/jpeg" }), filename);
  form.append("filename", filename);
  if (folder) form.append("folder", folder);
  if (existingTags.length > 0) form.append("tags", existingTags.join(","));
  if (wantTags) {
    form.append("includeTags", "true");
    form.append("tagCount", String(tagCount));
  }
  if (!wantDisplayName) {
    form.append("skipDisplayName", "true");
  }

  const res = await fetch(`${apiBase}/api/display-name/suggest`, {
    method: "POST",
    body: form,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload?.error || `AI metadata request failed (${res.status})`);
  }

  return {
    displayName: typeof payload?.displayName === "string" ? payload.displayName : undefined,
    tags: Array.isArray(payload?.tags) ? payload.tags.filter((t) => typeof t === "string") : [],
  };
}

async function uploadPreview({
  apiBase,
  previewBuffer,
  previewMime,
  previewFilename,
  namespace,
  folder,
  tags,
  description,
  displayName,
  sourcePath,
  originalFileUrl,
  duplicateAction,
}) {
  const form = new FormData();
  form.append("file", new Blob([previewBuffer], { type: previewMime || "image/jpeg" }), previewFilename);
  form.append("namespace", namespace);
  if (folder) form.append("folder", folder);
  if (tags.length > 0) form.append("tags", tags.join(","));
  if (description) form.append("description", description);
  if (displayName) form.append("displayName", displayName);
  if (sourcePath) form.append("sourceUrl", sourcePath);
  if (originalFileUrl) form.append("originalUrl", originalFileUrl);
  if (duplicateAction) form.append("duplicateAction", duplicateAction);

  const res = await fetch(`${apiBase}/api/upload/external`, {
    method: "POST",
    body: form,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, status: res.status, payload };
  }
  return { ok: true, status: res.status, payload };
}

async function uploadImageBuffer({
  apiBase,
  bytes,
  mime,
  uploadFilename,
  namespace,
  folder,
  tags,
  description,
  displayName,
  sourcePath,
  originalFileUrl,
  duplicateAction,
}) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mime }), uploadFilename);
  form.append("namespace", namespace);
  if (folder) form.append("folder", folder);
  if (tags.length > 0) form.append("tags", tags.join(","));
  if (description) form.append("description", description);
  if (displayName) form.append("displayName", displayName);
  if (sourcePath) form.append("sourceUrl", sourcePath);
  if (originalFileUrl) form.append("originalUrl", originalFileUrl);
  if (duplicateAction) form.append("duplicateAction", duplicateAction);

  const res = await fetch(`${apiBase}/api/upload/external`, {
    method: "POST",
    body: form,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, status: res.status, payload };
  }
  return { ok: true, status: res.status, payload };
}

async function uploadVideoBuffer({
  apiBase,
  bytes,
  mime,
  uploadFilename,
  namespace,
  folder,
  tags,
  description,
  sourcePath,
  originalFileUrl,
}) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mime }), uploadFilename);
  form.append("namespace", namespace);
  if (folder) form.append("folder", folder);
  if (tags.length > 0) form.append("tags", tags.join(","));
  if (description) form.append("description", description);
  if (sourcePath) form.append("sourceUrl", sourcePath);
  if (originalFileUrl) form.append("originalUrl", originalFileUrl);

  const res = await fetch(`${apiBase}/api/import/page/upload-video`, {
    method: "POST",
    body: form,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, status: res.status, payload };
  }
  return { ok: true, status: res.status, payload };
}

async function patchExtras({ apiBase, imageId, payload }) {
  const res = await fetch(`${apiBase}/api/images/${encodeURIComponent(imageId)}/extras`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `extras PATCH failed (${res.status})`);
  return data;
}

async function ensureEmbeddings({ apiBase, imageId }) {
  const res = await fetch(`${apiBase}/api/images/${encodeURIComponent(imageId)}/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clip: true, color: true, force: false }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `embeddings POST failed (${res.status})`);
  return data;
}

function formatSourcePath(rootDir, filePath) {
  const abs = path.resolve(filePath).split(path.sep).join("/");
  const rel = path.relative(rootDir, filePath).split(path.sep).join("/");
  return {
    absolute: `local://${abs}`,
    relative: `local://${rel}`,
  };
}

function createMinIntervalLimiter(minIntervalMs) {
  const interval = Math.max(0, Number(minIntervalMs) || 0);
  if (interval <= 0) return async () => {};
  let chain = Promise.resolve();
  let lastAt = 0;
  return async function waitTurn() {
    const next = chain.then(async () => {
      const now = Date.now();
      const waitMs = Math.max(0, lastAt + interval - now);
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      lastAt = Date.now();
    });
    chain = next.catch(() => {});
    await next;
  };
}

async function runWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function runWorker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  const workers = Array.from({ length: Math.max(1, concurrency) }, () => runWorker());
  await Promise.all(workers);
  return results;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  initTimestampedLogging(opts.timestamps);
  if (Array.isArray(opts.errors) && opts.errors.length > 0) {
    for (const err of opts.errors) console.error(`${color.red("[args]")} ${err}`);
    printUsage();
    process.exitCode = 1;
    return;
  }
  if (opts.help) {
    printUsage();
    return;
  }
  if (!opts.root || !opts.namespace) {
    printUsage();
    process.exitCode = 1;
    return;
  }
  if (["__all__", "__none__", "undefined"].includes(opts.namespace)) {
    throw new Error("Provide a specific --namespace (not __all__/__none__).");
  }

  const stats = await fs.stat(opts.root).catch(() => null);
  if (!stats?.isDirectory()) {
    throw new Error(`Root directory not found or not a directory: ${opts.root}`);
  }

  const checkpointPath = opts.checkpointFile || defaultCheckpointPath(opts.root, opts.namespace);
  const checkpoint = await loadCheckpoint(checkpointPath);
  const checkpointWrite = createSerializedTaskQueue();
  const files = await walkMediaFiles(opts.root, { limit: opts.limit });
  const baseTags = splitCsv(opts.tagsCsv).map(normalizeTag).filter(Boolean);
  const appendImageTag = normalizeTag(opts.appendImageTag);
  const counts = {
    total: files.length,
    uploaded: 0,
    failed: 0,
    skipped: 0,
    skippedCached: 0,
    skippedDuplicate: 0,
    aiSuggested: 0,
    extrasPatched: 0,
    extrasFailed: 0,
    embeddingsRequested: 0,
    embeddingsFailed: 0,
  };

  console.log(`${color.cyan("[scan]")} root=${opts.root}`);
  const imageCount = files.filter((f) => f.kind === "image").length;
  const videoCount = files.filter((f) => f.kind === "video").length;
  console.log(
    `${color.cyan("[scan]")} found=${counts.total} images=${color.blue(String(imageCount))} videos=${color.magenta(String(videoCount))}`
  );
  console.log(
    `${color.cyan("[config]")} namespace=${opts.namespace} apiBase=${opts.apiBase} previewMax=${opts.previewMax} previewFormat=${opts.previewFormat} quality=${opts.previewQuality} concurrency=${opts.concurrency} throttleMs=${opts.throttleMs} dryRun=${opts.dryRun ? "1" : "0"} ensureEmbeddings=${opts.ensureEmbeddings ? "1" : "0"} timestamps=${opts.timestamps ? "1" : "0"}`
  );
  console.log(`${color.cyan("[checkpoint]")} ${checkpointPath}`);
  if (counts.total === 0) return;

  const waitForUploadSlot = createMinIntervalLimiter(opts.throttleMs);

  await runWithConcurrency(files, opts.concurrency, async (item, index) => {
    const filePath = item.path;
    const relPath = path.relative(opts.root, filePath);
    const relDir = path.dirname(relPath).split(path.sep).join("/");
    const filename = path.basename(filePath);
    const prefix = `[${index + 1}/${counts.total}] IMG`;
    const nsToken = `${color.dim("ns=")}${color.cyan(opts.namespace)}`;
    try {
      const fileStat = await fs.stat(filePath);
      const signature = fileSignatureFromStat(fileStat);
      const cached = checkpoint.entries?.[relPath];
      const ext = path.extname(filePath).toLowerCase();
      const isDng = RAW_DNG_EXTENSIONS.has(ext);
      const isVideo = item.kind === "video";
      const uploadMime = MIME_BY_EXTENSION[ext] || "image/jpeg";

    if (
      cached &&
      cached.status === "uploaded" &&
      cached.signature === signature &&
      cached.kind === "media-catalog" &&
      cached.namespace === opts.namespace
    ) {
      counts.skipped += 1;
      counts.skippedCached += 1;
      if (opts.verbose || opts.dryRun) {
        const cachedId = typeof cached.assetId === "string" ? cached.assetId : "n/a";
        console.log(`${color.yellow(prefix)} ${nsToken} ${color.dim("skip(cached)")} ${relPath} ${color.dim("->")} ${cachedId}`);
      }
      return;
    }

    const contentHash = await hashFileContent(filePath);
    const hashKey = checkpointHashKey({
      namespace: opts.namespace,
      kind: item.kind,
      contentHash,
    });
    const hashCached = checkpoint.hashEntries?.[hashKey];
    if (
      hashCached &&
      hashCached.status === "uploaded" &&
      hashCached.namespace === opts.namespace &&
      hashCached.kind === "media-catalog"
    ) {
      counts.skipped += 1;
      counts.skippedCached += 1;
      checkpoint.entries[relPath] = {
        status: "uploaded",
        kind: "media-catalog",
        namespace: opts.namespace,
        signature,
        contentHash,
        assetId: typeof hashCached.assetId === "string" ? hashCached.assetId : "n/a",
        uploadedAt: typeof hashCached.uploadedAt === "string" ? hashCached.uploadedAt : new Date().toISOString(),
        note: "hash-cache-hit",
      };
      await checkpointWrite(() => saveCheckpoint(checkpointPath, checkpoint));
      if (opts.verbose || opts.dryRun) {
        const cachedId = typeof hashCached.assetId === "string" ? hashCached.assetId : "n/a";
        console.log(`${color.yellow(prefix)} ${nsToken} ${color.dim("skip(cached-hash)")} ${relPath} ${color.dim("->")} ${cachedId}`);
      }
      return;
    }

    const pathTags = opts.includePathTags && relDir && relDir !== "."
      ? relDir.split("/").map(normalizeTag).filter(Boolean)
      : [];
    const tags = uniqueStrings([...baseTags, ...pathTags]).slice(0, 12);

    const sourcePath = formatSourcePath(opts.root, filePath);
    const description = buildDescription({
      relDir,
      filename,
      relPath,
      absolutePath: path.resolve(filePath),
      descriptionPrefix: opts.descriptionPrefix,
      includeFilename: opts.includeFilename,
    });

    let exif;
    if (!isVideo) {
      try {
        exif = await extractExifDetails(filePath);
      } catch (error) {
        if (opts.verbose) {
          console.log(`${color.yellow("[exif][warn]")} ${relPath} ${color.dim("->")} ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    let uploadBytes;
    let aiBytes;
    let aiMime;
    let uploadFilename = filename;
    let preview;
    if (isDng) {
      try {
        preview = await createPreviewBuffer(filePath, {
          previewMax: opts.previewMax,
          previewFormat: "jpeg",
          quality: opts.previewQuality || opts.jpegQuality,
        });
      } catch (error) {
        counts.failed += 1;
      console.log(`${color.red(prefix)} ${color.red("fail")} ${relPath} ${color.dim("->")} ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      uploadBytes = preview.buffer;
      aiBytes = preview.buffer;
      aiMime = preview.mime;
      uploadFilename = `${path.basename(filename, path.extname(filename))}.jpg`;
    } else {
      uploadBytes = await fs.readFile(filePath);
      aiBytes = uploadBytes;
      aiMime = uploadMime;
    }
    let displayName;
    let aiTags = [];
    if (!isVideo && (opts.aiDisplayName || opts.aiTags)) {
      try {
        const ai = await suggestAiMetadata({
          apiBase: opts.apiBase,
          previewBuffer: aiBytes,
          previewMime: aiMime,
          filename: uploadFilename,
          folder: opts.folder,
          existingTags: tags,
          wantDisplayName: opts.aiDisplayName,
          wantTags: opts.aiTags,
          tagCount: opts.tagCount,
        });
        if (opts.aiDisplayName && ai.displayName) displayName = ai.displayName;
        if (opts.aiTags) aiTags = (ai.tags || []).map(normalizeTag).filter(Boolean);
        counts.aiSuggested += 1;
      } catch (error) {
        console.log(`${color.yellow("[ai][warn]")} ${relPath} ${color.dim("->")} ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const mergedTags = uniqueStrings([...tags, ...aiTags]).slice(0, 12);
    const finalTags = mergeTagsWithOptionalTail(mergedTags, appendImageTag, 12);

    if (opts.verbose || opts.dryRun) {
      console.log(`${color.bold(prefix)} ${nsToken} ${color.white(relPath)}`);
      console.log(`  ${kv("namespace", opts.namespace, color.cyan, color.cyan)}`);
      if (isDng && preview) {
        console.log(
          `  ${kv("conversion", "dng->jpeg", color.blue, color.blue)}  ${kv("preview", `${preview.width || "?"}x${preview.height || "?"}`, color.blue, color.white)}  ${kv("bytes", preview.size, color.blue, color.white)}  ${kv("method", preview.method, color.blue, color.white)}  ${kv("format", preview.format, color.blue, color.white)}`
        );
      } else if (isVideo) {
        console.log(
          `  ${kv("media", "video", color.magenta, color.magenta)}  ${kv("format", ext.replace(".", "") || "unknown", color.magenta, color.white)}  ${kv("bytes", uploadBytes.byteLength, color.magenta, color.white)}`
        );
      } else {
        console.log(
          `  ${kv("conversion", "none", color.dim, color.dim)}  ${kv("format", ext.replace(".", "") || "unknown", color.dim, color.white)}  ${kv("bytes", uploadBytes.byteLength, color.dim, color.white)}`
        );
      }
      if (aiTags.length) console.log(`  ${kv("aiTags", aiTags.join(", "), color.magenta, color.white)}`);
      if (displayName) console.log(`  ${kv("displayName", displayName, color.blue, color.white)}`);
      if (finalTags.length) console.log(`  ${kv("tags", finalTags.join(", "), color.green, color.white)}`);
      if (exif) {
        const exifLines = buildExifLogLines(exif);
        console.log(`  ${color.yellow("exif")}=${color.yellow("{")}`);
        for (const line of exifLines) {
          console.log(`    ${color.yellow(line)}`);
        }
        console.log(`  ${color.yellow("}")}`);
      }
      if (description) console.log(`  ${kv("description", description, color.dim, color.white)}`);
    }

    if (opts.dryRun) {
      counts.skipped += 1;
      return;
    }

    await waitForUploadSlot();

    const originalFileUrl = pathToFileURL(path.resolve(filePath)).toString();
    const outcome = isVideo
      ? await uploadVideoBuffer({
          apiBase: opts.apiBase,
          bytes: uploadBytes,
          mime: uploadMime,
          uploadFilename,
          namespace: opts.namespace,
          folder: opts.folder || undefined,
          tags: finalTags,
          description,
          sourcePath: sourcePath.absolute,
          originalFileUrl,
        })
      : await uploadImageBuffer({
          apiBase: opts.apiBase,
          bytes: uploadBytes,
          mime: isDng ? "image/jpeg" : uploadMime,
          uploadFilename,
          namespace: opts.namespace,
          folder: opts.folder || undefined,
          tags: finalTags,
          description,
          displayName,
          sourcePath: sourcePath.absolute,
          originalFileUrl,
        });

    let uploadedId;
    let statusNote;
    if (outcome.ok) {
      uploadedId = outcome.payload?.id || outcome.payload?.result?.id || "n/a";
      counts.uploaded += 1;
    } else if (
      outcome.status === 409 &&
      Array.isArray(outcome.payload?.duplicates) &&
      outcome.payload.duplicates.length > 0
    ) {
      uploadedId = outcome.payload.duplicates.find((d) => d && typeof d.id === "string")?.id || "duplicate";
      counts.skipped += 1;
      counts.skippedDuplicate += 1;
      statusNote = "duplicate-detected";
    } else {
      counts.failed += 1;
      const message =
        outcome.payload?.error ||
        outcome.payload?.message ||
        (Array.isArray(outcome.payload?.errors) && outcome.payload.errors[0]?.message) ||
        `HTTP ${outcome.status}`;
      console.log(`${color.red(prefix)} ${nsToken} ${color.red("fail")} ${relPath} ${color.dim("->")} ${message}`);
      return;
    }

    const nowIso = new Date().toISOString();
    const rawFingerprint = createHash("sha1")
      .update(`${contentHash}\n${fileStat.size}\n${Math.trunc(fileStat.mtimeMs)}\n${fileStat.dev || ""}\n${fileStat.ino || ""}`)
      .digest("hex");

    checkpoint.entries[relPath] = {
      status: "uploaded",
      kind: "media-catalog",
      namespace: opts.namespace,
      signature,
      contentHash,
      assetId: uploadedId,
      uploadedAt: nowIso,
      ...(statusNote ? { note: statusNote } : {}),
    };
    checkpoint.hashEntries[hashKey] = {
      status: "uploaded",
      kind: "media-catalog",
      namespace: opts.namespace,
      contentHash,
      assetId: uploadedId,
      uploadedAt: nowIso,
      sourcePath: relPath,
      ...(statusNote ? { note: statusNote } : {}),
    };
    await checkpointWrite(() => saveCheckpoint(checkpointPath, checkpoint));

    const extrasPayload = {
      rawSource: {
        absolutePath: path.resolve(filePath),
        relativePath: relPath.split(path.sep).join("/"),
        pathHash: createHash("sha256").update(path.resolve(filePath)).digest("hex"),
        contentHash,
        fingerprint: rawFingerprint,
        size: fileStat.size,
        mtimeMs: Math.trunc(fileStat.mtimeMs),
        dev: typeof fileStat.dev === "number" ? fileStat.dev : undefined,
        ino: typeof fileStat.ino === "number" ? fileStat.ino : undefined,
        capturedAt: nowIso,
      },
      ...(exif ? { exif } : {}),
      dngIngest: {
        sourceType: "dng",
        ingestedAt: nowIso,
        preview: {
          maxDimension: opts.previewMax,
          quality: opts.previewQuality,
          width: preview?.width,
          height: preview?.height,
          bytes: preview?.size,
          filename: isDng ? uploadFilename : undefined,
        },
      },
    };

    if (!isDng) {
      delete extrasPayload.dngIngest;
    }

    if (!isVideo) {
      try {
        if (uploadedId && uploadedId !== "n/a" && uploadedId !== "duplicate") {
          await patchExtras({
            apiBase: opts.apiBase,
            imageId: uploadedId,
            payload: extrasPayload,
          });
          counts.extrasPatched += 1;
        } else if (uploadedId && uploadedId !== "n/a") {
          await patchExtras({
            apiBase: opts.apiBase,
            imageId: uploadedId,
            payload: extrasPayload,
          });
          counts.extrasPatched += 1;
        }
      } catch (error) {
        counts.extrasFailed += 1;
        console.log(`${color.yellow("[extras][warn]")} ${relPath} ${color.dim("->")} ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (opts.ensureEmbeddings && uploadedId && uploadedId !== "n/a") {
      try {
        counts.embeddingsRequested += 1;
        await ensureEmbeddings({ apiBase: opts.apiBase, imageId: uploadedId });
      } catch (error) {
        counts.embeddingsFailed += 1;
        console.log(`${color.yellow("[embed][warn]")} ${relPath} ${color.dim("->")} ${error instanceof Error ? error.message : String(error)}`);
      }
    }

      if (statusNote === "duplicate-detected") {
        console.log(`${color.yellow(prefix)} ${nsToken} ${color.yellow("skip(duplicate)")} ${relPath} ${color.dim("->")} ${uploadedId}`);
      } else {
        console.log(`${color.green(prefix)} ${nsToken} ${color.green("ok")} ${relPath} ${color.dim("->")} ${uploadedId}`);
      }
    } catch (error) {
      counts.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.log(`${color.red(prefix)} ${nsToken} ${color.red("fail(unexpected)")} ${relPath} ${color.dim("->")} ${message}`);
    }
  });

  console.log(
    `${color.cyan("[done]")} uploaded=${color.green(String(counts.uploaded))} failed=${color.red(String(counts.failed))} skipped=${color.yellow(String(counts.skipped))} skippedCached=${counts.skippedCached} skippedDuplicate=${counts.skippedDuplicate} aiSuggested=${counts.aiSuggested} extrasPatched=${counts.extrasPatched} extrasFailed=${counts.extrasFailed} embeddingsRequested=${counts.embeddingsRequested} embeddingsFailed=${counts.embeddingsFailed}`
  );
}

main().catch((error) => {
  console.error(`${color.red("[error]")} ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
