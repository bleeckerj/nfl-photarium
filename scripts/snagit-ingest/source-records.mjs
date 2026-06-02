import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import AdmZip from 'adm-zip';
import { normalizeRelativePath } from './checkpoint.mjs';

const execFileAsync = promisify(execFile);

const IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.bmp',
  '.tif',
  '.tiff',
  '.avif',
  '.snagx',
]);

const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.webm',
  '.mov',
  '.m4v',
  '.ogv',
  '.ogg',
]);

const MIME_BY_EXTENSION = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.avif': 'image/avif',
  '.snagx': 'application/zip',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
  '.ogv': 'video/ogg',
  '.ogg': 'video/ogg',
};

const PROVIDER_HINT_SEGMENTS = [
  'dropbox',
  'cloudstorage',
  'file provider',
];

function sanitizeFilenameBase(value) {
  const cleaned = String(value || '')
    .replace(/[^a-zA-Z0-9-_]/g, '_')
    .replace(/_+/g, '_');
  const trimmed = cleaned.replace(/^_+|_+$/g, '');
  return trimmed || 'snagit-image';
}

function sourceTypeForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.snagx') return 'snagx';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  return null;
}

function assetKindForSourceType(sourceType) {
  return sourceType === 'video' ? 'video' : 'image';
}

function pathHasProviderHint(filePath) {
  const normalized = String(filePath || '').toLowerCase();
  return PROVIDER_HINT_SEGMENTS.some((segment) => normalized.includes(segment));
}

async function readXattrNames(filePath) {
  try {
    const result = await execFileAsync('xattr', [filePath], {
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
    return String(result.stdout || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function hasDropboxPlaceholderXattr(xattrNames) {
  return Array.isArray(xattrNames) && xattrNames.includes('com.dropbox.placeholder');
}

function hasDropboxProviderXattr(xattrNames) {
  return Array.isArray(xattrNames) && xattrNames.some((name) => name.startsWith('com.dropbox.'));
}

export function deriveProviderFileState({ filePath, stat, xattrNames }) {
  const dropboxProvider = hasDropboxProviderXattr(xattrNames);
  const placeholderByXattr = hasDropboxPlaceholderXattr(xattrNames);
  const fallbackPathHint = !dropboxProvider && pathHasProviderHint(filePath);
  const placeholderLikely = Boolean(
    placeholderByXattr
    || (dropboxProvider && stat && stat.size === 0)
    || (!xattrNames?.length && fallbackPathHint && stat && stat.size === 0)
  );

  return {
    providerHint: dropboxProvider || fallbackPathHint,
    placeholderLikely,
  };
}

export async function detectProviderFileState(filePath, stat) {
  const xattrNames = (
    stat?.size === 0 || pathHasProviderHint(filePath)
  ) ? await readXattrNames(filePath) : [];

  const derived = deriveProviderFileState({
    filePath,
    stat,
    xattrNames,
  });

  return {
    providerHint: derived.providerHint,
    xattrNames,
    placeholderLikely: derived.placeholderLikely,
  };
}

export async function walkSupportedFiles(roots) {
  const results = [];
  const queue = [...roots].map((rootDir) => ({ rootDir, dir: rootDir }));

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) continue;
    const { rootDir, dir } = next;
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (entry.name === '.DS_Store') continue;
      if (entry.name.startsWith('.')) continue;
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        queue.push({ rootDir, dir: absolutePath });
        continue;
      }
      if (!entry.isFile()) continue;
      const sourceType = sourceTypeForFile(absolutePath);
      if (!sourceType) continue;
      results.push({
        rootDir,
        absolutePath,
        relativePath: normalizeRelativePath(path.relative(rootDir, absolutePath)),
        sourceType,
        assetKind: assetKindForSourceType(sourceType),
      });
    }
  }

  return results;
}

export async function statSafe(filePath) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

export async function readPrefix(filePath, maxBytes) {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(Math.max(1, maxBytes));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export function buildLogicalSourceFingerprint(filePath, stat) {
  return {
    absolutePath: path.resolve(filePath),
    size: stat.size,
    mtimeMs: Math.trunc(stat.mtimeMs),
    dev: typeof stat.dev === 'number' ? stat.dev : undefined,
    ino: typeof stat.ino === 'number' ? stat.ino : undefined,
  };
}

export function sourceMatchesEntry(entry, filePath, stat) {
  if (!entry || !stat) return false;
  const statMtime = Math.trunc(stat.mtimeMs);
  const samePath = String(entry.absolutePath || '') === path.resolve(filePath);
  if (!samePath) return false;
  if (entry.size === stat.size && entry.mtimeMs === statMtime) return true;

  const providerHint = pathHasProviderHint(filePath);
  if (
    providerHint &&
    stat.size === 0 &&
    typeof entry.dev === 'number' &&
    typeof entry.ino === 'number' &&
    entry.dev === stat.dev &&
    entry.ino === stat.ino &&
    entry.mtimeMs === statMtime
  ) {
    return true;
  }

  return false;
}

function sanitizeSnagitMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value;
}

export function extractSnagxInfo(buffer, originalName) {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  const pngEntries = entries.filter((entry) => entry.entryName.toLowerCase().endsWith('.png'));
  if (pngEntries.length === 0) {
    throw new Error('No PNG images found inside .snagx archive');
  }

  const sorted = [...pngEntries].sort((a, b) => (b.header.size || 0) - (a.header.size || 0));
  const mainEntry = sorted[0];
  const metadataEntry = entries.find((entry) => entry.entryName.toLowerCase().endsWith('metadata.json'));

  let metadata;
  let captureDate;
  if (metadataEntry) {
    try {
      const parsed = JSON.parse(metadataEntry.getData().toString('utf8'));
      metadata = sanitizeSnagitMetadata(parsed);
      if (metadata && typeof metadata.CaptureDate === 'string') {
        captureDate = metadata.CaptureDate;
      }
    } catch {
      metadata = undefined;
    }
  }

  const baseName = originalName
    ? path.basename(originalName, path.extname(originalName))
    : path.basename(mainEntry.entryName, '.png');

  return {
    captureDate,
    metadata,
    extractedFilename: `${sanitizeFilenameBase(baseName)}.png`,
  };
}

export function buildSnagitSourceRecord({
  item,
  captureDate,
  metadata,
  extractedFilename,
}) {
  const extension = path.extname(item.absolutePath).toLowerCase();
  return {
    sourceType: item.sourceType,
    originalFileName: path.basename(item.absolutePath),
    originalExtension: extension,
    captureDate,
    metadata,
    extractedFilename,
  };
}

function formatSourcePath(filePath) {
  const absolute = path.resolve(filePath).split(path.sep).join('/');
  return {
    absolute: `local://${absolute}`,
    fileUrl: pathToFileURL(path.resolve(filePath)).toString(),
  };
}

function buildRawSourceRecord(item, stat, sourceContentHash, capturedAt) {
  const absolutePath = path.resolve(item.absolutePath);
  const fingerprint = createHash('sha1')
    .update([
      sourceContentHash,
      stat.size,
      Math.trunc(stat.mtimeMs),
      stat.dev || '',
      stat.ino || '',
    ].join('\n'))
    .digest('hex');

  return {
    absolutePath,
    relativePath: item.relativePath,
    pathHash: createHash('sha256').update(absolutePath).digest('hex'),
    contentHash: sourceContentHash,
    fingerprint,
    size: stat.size,
    mtimeMs: Math.trunc(stat.mtimeMs),
    dev: typeof stat.dev === 'number' ? stat.dev : undefined,
    ino: typeof stat.ino === 'number' ? stat.ino : undefined,
    capturedAt,
  };
}

export function buildImageExtrasPayload({ item, stat, sourceContentHash, snagitInfo, capturedAt }) {
  return {
    rawSource: buildRawSourceRecord(item, stat, sourceContentHash, capturedAt),
    snagitSource: buildSnagitSourceRecord({
      item,
      captureDate: snagitInfo?.captureDate,
      metadata: snagitInfo?.metadata,
      extractedFilename: snagitInfo?.extractedFilename,
    }),
  };
}

export function buildBaseTags(item, extraTags) {
  const tags = ['snagit', ...extraTags];
  if (item.sourceType === 'snagx') tags.push('snagx');
  return Array.from(new Set(tags.filter(Boolean)));
}

export async function uploadImageFile({
  apiBase,
  item,
  bytes,
  namespace,
  folder,
  tags,
  duplicateAction,
}) {
  const sourcePath = formatSourcePath(item.absolutePath);
  const ext = path.extname(item.absolutePath).toLowerCase();
  const fileName = path.basename(item.absolutePath);
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: MIME_BY_EXTENSION[ext] || 'application/octet-stream' }), fileName);
  form.append('namespace', namespace);
  if (folder) form.append('folder', folder);
  if (tags.length > 0) form.append('tags', tags.join(','));
  form.append('sourceUrl', sourcePath.absolute);
  form.append('originalUrl', sourcePath.fileUrl);
  if (duplicateAction) form.append('duplicateAction', duplicateAction);

  const response = await fetch(`${apiBase}/api/upload/external`, {
    method: 'POST',
    body: form,
  });
  const payload = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    status: response.status,
    payload,
  };
}

export async function uploadVideoFile({
  apiBase,
  item,
  bytes,
  namespace,
  folder,
  tags,
}) {
  const sourcePath = formatSourcePath(item.absolutePath);
  const ext = path.extname(item.absolutePath).toLowerCase();
  const fileName = path.basename(item.absolutePath);
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: MIME_BY_EXTENSION[ext] || 'video/mp4' }), fileName);
  form.append('namespace', namespace);
  if (folder) form.append('folder', folder);
  if (tags.length > 0) form.append('tags', tags.join(','));
  form.append('sourceUrl', sourcePath.absolute);
  form.append('originalUrl', sourcePath.fileUrl);

  const response = await fetch(`${apiBase}/api/import/page/upload-video`, {
    method: 'POST',
    body: form,
  });
  const payload = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    status: response.status,
    payload,
  };
}

export async function patchImageExtras({ apiBase, imageId, payload }) {
  const response = await fetch(`${apiBase}/api/images/${encodeURIComponent(imageId)}/extras`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || `extras PATCH failed (${response.status})`);
  }
  return data;
}

export async function ensureImageEmbeddings({ apiBase, imageId }) {
  const response = await fetch(`${apiBase}/api/images/${encodeURIComponent(imageId)}/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clip: true, color: true, force: false }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || `image embeddings POST failed (${response.status})`);
  }
  return data;
}

export async function ensureVideoEmbeddings({ apiBase, videoId }) {
  const response = await fetch(`${apiBase}/api/videos/${encodeURIComponent(videoId)}`, {
    method: 'POST',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || `video embeddings POST failed (${response.status})`);
  }
  return data;
}
