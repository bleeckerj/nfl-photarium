#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { parseArgs, printUsage } from "./dng-ingest/cli.mjs";
import {
  checkpointHashKey,
  defaultCheckpointPath,
  fileSignatureFromStat,
  loadCheckpoint,
  saveCheckpoint,
} from "./dng-ingest/checkpoint.mjs";
import { createMinIntervalLimiter, runWithConcurrency } from "./lib/concurrency.mjs";
import {
  mergeTagsWithOptionalTail,
  normalizeTag,
  splitCsv,
  uniqueStrings,
} from "./fs-ingest/tagging.mjs";
import { buildExifLogLines, extractExifDetails } from "./dng-ingest/exif.mjs";

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

const isDirectRun = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((error) => {
    console.error(`${color.red("[error]")} ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

export { parseArgs };
