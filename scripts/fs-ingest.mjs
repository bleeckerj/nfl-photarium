#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".avif"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".m4v", ".ogv", ".ogg"]);

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
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/mp4",
  ".ogv": "video/ogg",
  ".ogg": "video/ogg",
};

function printUsage() {
  console.log(`Recursive Filesystem Ingest CLI

Usage:
  node scripts/fs-ingest.mjs --root <dir> --namespace <name> [options]

Required:
  --root <dir>                Root directory to recursively scan
  --namespace <name>          Target namespace (required)

Options:
  --api-base <url>            API base URL (default: http://localhost:3000)
  --checkpoint-file <path>    Override checkpoint file path (share cache across roots)
  --folder <name>             Optional folder value for uploaded assets
  --tags <csv>                Base tags to apply to every file
  --append-image-tag <tag>    Optional tag appended to image tags (after AI tags)
  --hash-cache-backfill-only  Compute/write content-hash cache entries only (no uploads)
  --assume-uploaded           With --hash-cache-backfill-only, seed cache for files not in path cache
  --report-cache              Print exact checkpoint hit estimate before upload pass (path + hash cache coverage)
  --description-prefix <txt>  Prefix text prepended to description
  --include-filename          Include filename in description
  --include-path-tags         Add subdirectory names as tags
  --ai-metadata               For images: generate displayName and tags with AI
  --ai-display-name           For images: generate displayName only
  --ai-tags                   For images: generate tags only
  --tag-count <n>             AI tag count target (default: 4)
  --concurrency <n>           Parallel uploads (default: 2)
  --throttle-ms <n>          Minimum delay between upload requests (global, default: 0)
  --on-duplicate <mode>      Duplicate handling for image uploads: reject|family (default: reject)
  --limit <n>                 Stop after N matching files
  --dry-run                   Print planned uploads without uploading
  --verbose                   More logging
  --help                      Show this help

Examples:
  node scripts/fs-ingest.mjs --root ~/Code/chester-downloads-discord-images --namespace midjourney
  node scripts/fs-ingest.mjs --root ~/Code/chester-downloads-discord-images --namespace mj-archive --folder discord --ai-metadata --tag-count 4
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
    hashCacheBackfillOnly: false,
    reportCache: false,
    assumeUploaded: false,
    descriptionPrefix: "",
    includeFilename: false,
    includePathTags: false,
    aiMetadata: false,
    aiDisplayName: false,
    aiTags: false,
    tagCount: 4,
    concurrency: 2,
    throttleMs: 0,
    onDuplicate: "reject",
    limit: 0,
    dryRun: false,
    verbose: false,
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
    } else if (arg === "--hash-cache-backfill-only") {
      opts.hashCacheBackfillOnly = true;
    } else if (arg === "--assume-uploaded") {
      opts.assumeUploaded = true;
    } else if (arg === "--report-cache") {
      opts.reportCache = true;
    } else if (arg === "--description-prefix") {
      if (!requireValue(arg, next)) continue;
      opts.descriptionPrefix = next;
      i += 1;
    } else if (arg === "--tag-count") {
      if (!requireValue(arg, next)) continue;
      opts.tagCount = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === "--concurrency") {
      if (!requireValue(arg, next)) continue;
      opts.concurrency = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === "--throttle-ms") {
      if (!requireValue(arg, next)) continue;
      opts.throttleMs = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === "--on-duplicate") {
      if (!requireValue(arg, next)) continue;
      opts.onDuplicate = next.trim().toLowerCase();
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
    } else if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--verbose") {
      opts.verbose = true;
    } else if (arg.startsWith("-")) {
      errors.push(unknownFlagMessage(arg));
    } else {
      errors.push(`Unexpected positional argument: ${arg}`);
    }
  }

  if (opts.aiMetadata) {
    opts.aiDisplayName = true;
    opts.aiTags = true;
  }
  if (!Number.isFinite(opts.tagCount) || opts.tagCount < 1) opts.tagCount = 4;
  if (!Number.isFinite(opts.concurrency) || opts.concurrency < 1) opts.concurrency = 2;
  if (!Number.isFinite(opts.throttleMs) || opts.throttleMs < 0) opts.throttleMs = 0;
  if (!Number.isFinite(opts.limit) || opts.limit < 0) opts.limit = 0;
  if (!["reject", "family"].includes(opts.onDuplicate)) {
    errors.push(`Invalid value for --on-duplicate: ${opts.onDuplicate} (expected reject or family)`);
    opts.onDuplicate = "reject";
  }
  return { ...opts, errors };
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

function mergeTagsWithOptionalTail(base, tail, limit = 12) {
  const merged = uniqueStrings(base).slice(0, Math.max(0, limit));
  const extra = String(tail || "").trim();
  if (!extra) return merged;
  if (merged.includes(extra)) return merged;
  if (merged.length < limit) return [...merged, extra];
  return [...merged.slice(0, Math.max(0, limit - 1)), extra];
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

function stablePathKey(rootDir, namespace) {
  return createHash("sha1")
    .update(`${path.resolve(rootDir)}\n${namespace}`)
    .digest("hex")
    .slice(0, 16);
}

function defaultCheckpointPath(rootDir, namespace) {
  const key = stablePathKey(rootDir, namespace);
  return path.resolve("data", "fs-ingest-checkpoints", `${key}.json`);
}

function fileSignatureFromStat(stat) {
  return `${stat.size}:${Math.trunc(stat.mtimeMs)}`;
}

function checkpointHashKey({ namespace, kind, contentHash }) {
  return `${namespace}\n${kind}\n${contentHash}`;
}

function normalizeRelativePath(relPath) {
  return String(relPath || "").split(path.sep).join("/");
}

function checkpointEntryKey({ rootDir, namespace, relPath }) {
  return `${stablePathKey(rootDir, namespace)}\n${normalizeRelativePath(relPath)}`;
}

async function loadCheckpoint(checkpointPath) {
  try {
    const raw = await fs.readFile(checkpointPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { version: 2, entries: {}, hashEntries: {} };
    const entries = parsed.entries && typeof parsed.entries === "object" ? parsed.entries : {};
    const hashEntries = parsed.hashEntries && typeof parsed.hashEntries === "object" ? parsed.hashEntries : {};
    return {
      version: 2,
      entries,
      hashEntries,
    };
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

async function hashFileContent(filePath) {
  const bytes = await fs.readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

function createSerializedTaskQueue() {
  let chain = Promise.resolve();
  return async (task) => {
    const next = chain.then(task);
    chain = next.catch(() => {});
    return next;
  };
}

function assetTypeForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  return null;
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
      const kind = assetTypeForFile(abs);
      if (!kind) continue;
      out.push({ path: abs, kind });
      if (limit > 0 && out.length >= limit) return out;
    }
  }

  return out;
}

function buildDescription({
  relDir,
  filename,
  descriptionPrefix,
  includeFilename,
}) {
  const parts = [];
  if (descriptionPrefix) parts.push(descriptionPrefix.trim());
  if (relDir && relDir !== ".") parts.push(`Subdirectories: ${relDir}`);
  if (includeFilename) parts.push(`Filename: ${filename}`);
  return parts.join(" | ").trim() || undefined;
}

async function suggestAiMetadata({
  apiBase,
  filePath,
  filename,
  folder,
  existingTags,
  wantDisplayName,
  wantTags,
  tagCount,
}) {
  const form = new FormData();
  const bytes = await fs.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_BY_EXTENSION[ext] || "image/jpeg";
  form.append("file", new Blob([bytes], { type: mime }), filename);
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
    model: typeof payload?.model === "string" ? payload.model : undefined,
  };
}

export async function uploadImage({
  apiBase,
  filePath,
  namespace,
  folder,
  tags,
  description,
  displayName,
  sourcePath,
  duplicateAction,
}) {
  const filename = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_BY_EXTENSION[ext] || "image/jpeg";
  const bytes = await fs.readFile(filePath);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mime }), filename);
  form.append("namespace", namespace);
  if (folder) form.append("folder", folder);
  if (tags.length > 0) form.append("tags", tags.join(","));
  if (description) form.append("description", description);
  if (displayName) form.append("displayName", displayName);
  form.append("sourceUrl", sourcePath);
  if (duplicateAction === "family") form.append("duplicateAction", duplicateAction);

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

async function uploadVideo({
  apiBase,
  filePath,
  namespace,
  folder,
  tags,
  description,
  sourcePath,
}) {
  const filename = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_BY_EXTENSION[ext] || "video/mp4";
  const bytes = await fs.readFile(filePath);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mime }), filename);
  form.append("namespace", namespace);
  if (folder) form.append("folder", folder);
  if (tags.length > 0) form.append("tags", tags.join(","));
  if (description) form.append("description", description);
  form.append("sourceUrl", sourcePath);

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

function formatSourcePath(rootDir, filePath) {
  const rel = path.relative(rootDir, filePath);
  return `local://${rel.split(path.sep).join("/")}`;
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

function createMinIntervalLimiter(minIntervalMs) {
  const interval = Math.max(0, Number(minIntervalMs) || 0);
  if (interval <= 0) {
    return async () => {};
  }

  let chain = Promise.resolve();
  let lastAt = 0;

  return async function waitTurn() {
    const next = chain.then(async () => {
      const now = Date.now();
      const waitMs = Math.max(0, lastAt + interval - now);
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
      lastAt = Date.now();
    });
    chain = next.catch(() => {});
    await next;
  };
}

async function backfillHashCacheOnly({
  opts,
  files,
  checkpoint,
  checkpointPath,
  checkpointWrite,
  counts,
}) {
  let scanned = 0;
  let addedHashEntries = 0;
  let updatedPathEntries = 0;
  let assumedSeeded = 0;
  let skippedNotInPathCache = 0;
  let skippedPathMismatch = 0;
  let skippedExistingHash = 0;
  let failedHashReads = 0;

  console.log("[mode] hash-cache-backfill-only (no uploads, no AI metadata)");
  if (opts.assumeUploaded) {
    console.log("[mode][warn] assume-uploaded enabled: seeding cache for files without prior path-cache evidence");
  }

  await runWithConcurrency(files, opts.concurrency, async (item, index) => {
    const filePath = item.path;
    const relPath = path.relative(opts.root, filePath);
    const pathKey = checkpointEntryKey({
      rootDir: opts.root,
      namespace: opts.namespace,
      relPath,
    });
    const prefix = `[${index + 1}/${counts.total}] ${item.kind.toUpperCase()}`;
    scanned += 1;

    const existingPathEntry = checkpoint.entries?.[pathKey];
    const hasMatchingPathCache =
      !existingPathEntry ||
      existingPathEntry.status !== "uploaded" ||
      existingPathEntry.namespace !== opts.namespace ||
      existingPathEntry.kind !== item.kind
        ? false
        : true;

    if (!hasMatchingPathCache && !opts.assumeUploaded) {
      skippedNotInPathCache += 1;
      if (opts.verbose) {
        console.log(`${prefix} hash-cache-skip(no-path-cache) ${relPath}`);
      }
      return;
    }

    if (!hasMatchingPathCache && opts.assumeUploaded) {
      const fileStat = await fs.stat(filePath);
      const signature = fileSignatureFromStat(fileStat);
      let contentHash;
      try {
        contentHash = await hashFileContent(filePath);
      } catch (error) {
        failedHashReads += 1;
        console.log(`[cache][warn] hash read failed for ${relPath} -> ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      const hashKey = checkpointHashKey({
        namespace: opts.namespace,
        kind: item.kind,
        contentHash,
      });
      const existingHashEntry = checkpoint.hashEntries?.[hashKey];

      checkpoint.entries[pathKey] = {
        status: "uploaded",
        kind: item.kind,
        namespace: opts.namespace,
        signature,
        contentHash,
        assetId: typeof existingHashEntry?.assetId === "string" ? existingHashEntry.assetId : "assumed-uploaded",
        uploadedAt:
          typeof existingHashEntry?.uploadedAt === "string" ? existingHashEntry.uploadedAt : new Date().toISOString(),
        note: "hash-cache-backfill-assume-uploaded",
      };
      checkpoint.hashEntries[hashKey] = {
        status: "uploaded",
        kind: item.kind,
        namespace: opts.namespace,
        contentHash,
        assetId: typeof existingHashEntry?.assetId === "string" ? existingHashEntry.assetId : "assumed-uploaded",
        uploadedAt:
          typeof existingHashEntry?.uploadedAt === "string" ? existingHashEntry.uploadedAt : new Date().toISOString(),
        sourcePath: relPath,
        note: "hash-cache-backfill-assume-uploaded",
      };
      assumedSeeded += 1;
      updatedPathEntries += 1;
      if (!existingHashEntry) addedHashEntries += 1;
      await checkpointWrite(() => saveCheckpoint(checkpointPath, checkpoint));
      if (opts.verbose) {
        console.log(`${prefix} hash-cache-assumed ${relPath}`);
      }
      return;
    }

    const fileStat = await fs.stat(filePath);
    const signature = fileSignatureFromStat(fileStat);
    if (existingPathEntry.signature !== signature) {
      skippedPathMismatch += 1;
      if (opts.verbose) {
        console.log(`${prefix} hash-cache-skip(signature-mismatch) ${relPath}`);
      }
      return;
    }

    let contentHash;
    try {
      contentHash = await hashFileContent(filePath);
    } catch (error) {
      failedHashReads += 1;
      console.log(`[cache][warn] hash read failed for ${relPath} -> ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    const hashKey = checkpointHashKey({
      namespace: opts.namespace,
      kind: item.kind,
      contentHash,
    });
    const existingHashEntry = checkpoint.hashEntries?.[hashKey];

    let touched = false;
    if (
      existingPathEntry.contentHash !== contentHash
    ) {
      checkpoint.entries[pathKey] = {
        ...existingPathEntry,
        contentHash,
      };
      updatedPathEntries += 1;
      touched = true;
    }

    if (
      !existingHashEntry ||
      existingHashEntry.status !== "uploaded" ||
      existingHashEntry.namespace !== opts.namespace ||
      existingHashEntry.kind !== item.kind
    ) {
      checkpoint.hashEntries[hashKey] = {
        status: "uploaded",
        kind: item.kind,
        namespace: opts.namespace,
        contentHash,
        assetId: typeof existingPathEntry?.assetId === "string" ? existingPathEntry.assetId : "n/a",
        uploadedAt:
          typeof existingPathEntry?.uploadedAt === "string" ? existingPathEntry.uploadedAt : new Date().toISOString(),
        sourcePath: relPath,
        note: "hash-cache-backfill-only",
      };
      addedHashEntries += 1;
      touched = true;
    } else {
      skippedExistingHash += 1;
    }

    if (touched) {
      await checkpointWrite(() => saveCheckpoint(checkpointPath, checkpoint));
    }

    if (opts.verbose) {
      const action = touched ? "hash-cache-updated" : "hash-cache-present";
      console.log(`${prefix} ${action} ${relPath}`);
    }
  });

  console.log(
    `[hash-cache] scanned=${scanned} addedHashEntries=${addedHashEntries} updatedPathEntries=${updatedPathEntries} assumedSeeded=${assumedSeeded} existingHashEntries=${skippedExistingHash} skippedNoPathCache=${skippedNotInPathCache} skippedSignatureMismatch=${skippedPathMismatch} failedHashReads=${failedHashReads}`
  );
}

async function reportCheckpointCoverage({
  opts,
  files,
  checkpoint,
}) {
  let pathHits = 0;
  let hashHits = 0;
  let hashReadErrors = 0;
  let statErrors = 0;

  await runWithConcurrency(files, Math.max(1, opts.concurrency), async (item) => {
    const filePath = item.path;
    const relPath = path.relative(opts.root, filePath);
    const pathKey = checkpointEntryKey({
      rootDir: opts.root,
      namespace: opts.namespace,
      relPath,
    });

    let fileStat;
    try {
      fileStat = await fs.stat(filePath);
    } catch (error) {
      statErrors += 1;
      if (opts.verbose) {
        console.log(`[cache][warn] stat failed for ${relPath} -> ${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }
    const signature = fileSignatureFromStat(fileStat);
    const cached = checkpoint.entries?.[pathKey];
    if (
      cached &&
      cached.status === "uploaded" &&
      cached.signature === signature &&
      cached.kind === item.kind &&
      cached.namespace === opts.namespace
    ) {
      pathHits += 1;
      return;
    }

    let contentHash;
    try {
      contentHash = await hashFileContent(filePath);
    } catch (error) {
      hashReadErrors += 1;
      if (opts.verbose) {
        console.log(`[cache][warn] hash read failed for ${relPath} -> ${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }

    const hashCached = checkpoint.hashEntries?.[checkpointHashKey({
      namespace: opts.namespace,
      kind: item.kind,
      contentHash,
    })];

    if (
      hashCached &&
      hashCached.status === "uploaded" &&
      hashCached.namespace === opts.namespace &&
      hashCached.kind === item.kind
    ) {
      hashHits += 1;
    }
  });

  const total = files.length;
  const totalHits = pathHits + hashHits;
  const hitRate = total > 0 ? (totalHits / total) * 100 : 100;
  const missRate = total > 0 ? ((total - totalHits) / total) * 100 : 0;
  console.log(
    `[cache] preflight total=${total} pathHits=${pathHits} hashHits=${hashHits} misses=${total - totalHits} hitRate=${hitRate.toFixed(2)}% missRate=${missRate.toFixed(2)}% statErrors=${statErrors} hashReadErrors=${hashReadErrors}`
  );
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (Array.isArray(opts.errors) && opts.errors.length > 0) {
    for (const err of opts.errors) console.error(`[args] ${err}`);
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

  const baseTags = splitCsv(opts.tagsCsv).map(normalizeTag).filter(Boolean);
  const appendImageTag = normalizeTag(opts.appendImageTag);
  const checkpointPath = opts.checkpointFile || defaultCheckpointPath(opts.root, opts.namespace);
  const checkpoint = await loadCheckpoint(checkpointPath);
  const checkpointWrite = createSerializedTaskQueue();
  const files = await walkMediaFiles(opts.root, { limit: opts.limit });
  const counts = {
    total: files.length,
    images: files.filter((f) => f.kind === "image").length,
    videos: files.filter((f) => f.kind === "video").length,
    uploaded: 0,
    failed: 0,
    skipped: 0,
    skippedCached: 0,
    aiSuggested: 0,
  };

  console.log(`[scan] root=${opts.root}`);
  console.log(`[scan] found=${counts.total} images=${counts.images} videos=${counts.videos}`);
  console.log(
    `[config] namespace=${opts.namespace} apiBase=${opts.apiBase} concurrency=${opts.concurrency} throttleMs=${opts.throttleMs} onDuplicate=${opts.onDuplicate} dryRun=${opts.dryRun ? "1" : "0"} hashBackfillOnly=${opts.hashCacheBackfillOnly ? "1" : "0"} assumeUploaded=${opts.assumeUploaded ? "1" : "0"}`
  );
  console.log(`[checkpoint] ${checkpointPath}`);

  if (counts.total === 0) return;
  if (opts.reportCache) {
    await reportCheckpointCoverage({
      opts,
      files,
      checkpoint,
    });
  }

  if (opts.hashCacheBackfillOnly) {
    await backfillHashCacheOnly({
      opts,
      files,
      checkpoint,
      checkpointPath,
      checkpointWrite,
      counts,
    });
    console.log(
      `[done] uploaded=${counts.uploaded} failed=${counts.failed} skipped=${counts.skipped} skippedCached=${counts.skippedCached} aiSuggested=${counts.aiSuggested}`
    );
    return;
  }
  const waitForUploadSlot = createMinIntervalLimiter(opts.throttleMs);

  await runWithConcurrency(files, opts.concurrency, async (item, index) => {
    const filePath = item.path;
    const relPath = path.relative(opts.root, filePath);
    const pathKey = checkpointEntryKey({
      rootDir: opts.root,
      namespace: opts.namespace,
      relPath,
    });
    const relDir = path.dirname(relPath).split(path.sep).join("/");
    const filename = path.basename(filePath);
    const fileStat = await fs.stat(filePath);
    const signature = fileSignatureFromStat(fileStat);
    const cached = checkpoint.entries?.[pathKey];
    const prefix = `[${index + 1}/${counts.total}] ${item.kind.toUpperCase()}`;
    if (
      cached &&
      cached.status === "uploaded" &&
      cached.signature === signature &&
      cached.kind === item.kind &&
      cached.namespace === opts.namespace
    ) {
      counts.skipped += 1;
      counts.skippedCached += 1;
      if (opts.verbose || opts.dryRun) {
        const cachedId = typeof cached.assetId === "string" ? cached.assetId : "n/a";
        console.log(`${prefix} skip(cached) ${relPath} -> ${cachedId}`);
      }

      if (item.kind === "image" || item.kind === "video") {
        const hasHashIndex =
          typeof cached.contentHash === "string" &&
          Boolean(checkpoint.hashEntries?.[checkpointHashKey({
            namespace: opts.namespace,
            kind: item.kind,
            contentHash: cached.contentHash,
          })]);
        if (!hasHashIndex) {
          try {
            const contentHash = await hashFileContent(filePath);
            cached.contentHash = contentHash;
            checkpoint.hashEntries[checkpointHashKey({
              namespace: opts.namespace,
              kind: item.kind,
              contentHash,
            })] = {
              status: "uploaded",
              kind: item.kind,
              namespace: opts.namespace,
              contentHash,
              assetId: typeof cached.assetId === "string" ? cached.assetId : "n/a",
              uploadedAt: typeof cached.uploadedAt === "string" ? cached.uploadedAt : new Date().toISOString(),
              sourcePath: relPath,
              note: "hash-cache-backfilled-from-path-cache",
            };
            await checkpointWrite(() => saveCheckpoint(checkpointPath, checkpoint));
          } catch (error) {
            console.log(`[cache][warn] hash backfill failed for ${relPath} -> ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
      return;
    }

    let contentHash;
    try {
      contentHash = await hashFileContent(filePath);
    } catch (error) {
      console.log(`[cache][warn] hash read failed for ${relPath} -> ${error instanceof Error ? error.message : String(error)}`);
    }

    if (contentHash) {
      const hashCached = checkpoint.hashEntries?.[checkpointHashKey({
        namespace: opts.namespace,
        kind: item.kind,
        contentHash,
      })];
      if (
        hashCached &&
        hashCached.status === "uploaded" &&
        hashCached.namespace === opts.namespace &&
        hashCached.kind === item.kind
      ) {
        counts.skipped += 1;
        counts.skippedCached += 1;
        checkpoint.entries[pathKey] = {
          status: "uploaded",
          kind: item.kind,
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
          console.log(`${prefix} skip(cached-hash) ${relPath} -> ${cachedId}`);
        }
        return;
      }
    }

    const pathTags = opts.includePathTags && relDir && relDir !== "."
      ? relDir.split("/").map(normalizeTag).filter(Boolean)
      : [];
    const tags = uniqueStrings([...baseTags, ...pathTags]).slice(0, 12);
    const description = buildDescription({
      relDir,
      filename,
      descriptionPrefix: opts.descriptionPrefix,
      includeFilename: opts.includeFilename,
    });
    const sourcePath = formatSourcePath(opts.root, filePath);

    let displayName;
    let aiTags = [];
    if (item.kind === "image" && (opts.aiDisplayName || opts.aiTags)) {
      try {
        const ai = await suggestAiMetadata({
          apiBase: opts.apiBase,
          filePath,
          filename,
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
        console.log(`[ai][warn] ${relPath} -> ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const mergedTags = uniqueStrings([...tags, ...aiTags]).slice(0, 12);
    const finalTags = item.kind === "image"
      ? mergeTagsWithOptionalTail(mergedTags, appendImageTag, 12)
      : mergedTags;
    if (opts.verbose || opts.dryRun) {
      console.log(`${prefix} ${relPath}`);
      if (displayName) console.log(`  displayName=${displayName}`);
      if (finalTags.length) console.log(`  tags=${finalTags.join(", ")}`);
      if (description) console.log(`  description=${description}`);
    }

    if (opts.dryRun) {
      counts.skipped += 1;
      return;
    }

    await waitForUploadSlot();

    const outcome = item.kind === "image"
      ? await uploadImage({
          apiBase: opts.apiBase,
          filePath,
          namespace: opts.namespace,
          folder: opts.folder || undefined,
          tags: finalTags,
          description,
          displayName,
          sourcePath,
          duplicateAction: opts.onDuplicate,
        })
      : await uploadVideo({
          apiBase: opts.apiBase,
          filePath,
          namespace: opts.namespace,
          folder: opts.folder || undefined,
          tags: finalTags,
          description,
          sourcePath,
        });

    if (outcome.ok) {
      counts.uploaded += 1;
      const id = outcome.payload?.id || outcome.payload?.result?.id || "n/a";
      checkpoint.entries[pathKey] = {
        status: "uploaded",
        kind: item.kind,
        namespace: opts.namespace,
        signature,
        ...(contentHash ? { contentHash } : {}),
        assetId: id,
        uploadedAt: new Date().toISOString(),
      };
      if (contentHash) {
        checkpoint.hashEntries[checkpointHashKey({
          namespace: opts.namespace,
          kind: item.kind,
          contentHash,
        })] = {
          status: "uploaded",
          kind: item.kind,
          namespace: opts.namespace,
          contentHash,
          assetId: id,
          uploadedAt: new Date().toISOString(),
          sourcePath: relPath,
        };
      }
      await checkpointWrite(() => saveCheckpoint(checkpointPath, checkpoint));
      console.log(`${prefix} ok ${relPath} -> ${id}`);
      return;
    }

    if (
      item.kind === "image" &&
      outcome.status === 409 &&
      Array.isArray(outcome.payload?.duplicates) &&
      outcome.payload.duplicates.length > 0
    ) {
      counts.skipped += 1;
      const duplicateId = outcome.payload.duplicates.find((d) => d && typeof d.id === "string")?.id || "duplicate";
      checkpoint.entries[pathKey] = {
        status: "uploaded",
        kind: item.kind,
        namespace: opts.namespace,
        signature,
        ...(contentHash ? { contentHash } : {}),
        assetId: duplicateId,
        uploadedAt: new Date().toISOString(),
        note: "duplicate-detected",
      };
      if (contentHash) {
        checkpoint.hashEntries[checkpointHashKey({
          namespace: opts.namespace,
          kind: item.kind,
          contentHash,
        })] = {
          status: "uploaded",
          kind: item.kind,
          namespace: opts.namespace,
          contentHash,
          assetId: duplicateId,
          uploadedAt: new Date().toISOString(),
          sourcePath: relPath,
          note: "duplicate-detected",
        };
      }
      await checkpointWrite(() => saveCheckpoint(checkpointPath, checkpoint));
      console.log(`${prefix} skip(duplicate) ${relPath} -> ${duplicateId}`);
      return;
    }

    counts.failed += 1;
    const message =
      outcome.payload?.error ||
      outcome.payload?.message ||
      (Array.isArray(outcome.payload?.errors) && outcome.payload.errors[0]?.message) ||
      `HTTP ${outcome.status}`;
    console.log(`${prefix} fail ${relPath} -> ${message}`);
  });

  console.log(
    `[done] uploaded=${counts.uploaded} failed=${counts.failed} skipped=${counts.skipped} skippedCached=${counts.skippedCached} aiSuggested=${counts.aiSuggested}`
  );
}

const isDirectRun = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((error) => {
    console.error(`[error] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

export { parseArgs };
