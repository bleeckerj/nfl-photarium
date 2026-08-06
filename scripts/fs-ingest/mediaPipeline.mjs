import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.avif']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.m4v', '.ogv', '.ogg']);
const MIME_BY_EXTENSION = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.tif': 'image/tiff', '.tiff': 'image/tiff', '.avif': 'image/avif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.ogv': 'video/ogg', '.ogg': 'video/ogg' };

export async function hashFileContent(filePath) { return createHash('sha256').update(await fs.readFile(filePath)).digest('hex'); }

export function createSerializedTaskQueue() {
  let chain = Promise.resolve();
  return async (task) => { const next = chain.then(task); chain = next.catch(() => {}); return next; };
}

function assetTypeForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext) ? 'image' : VIDEO_EXTENSIONS.has(ext) ? 'video' : null;
}

export async function walkMediaFiles(rootDir, { limit = 0 } = {}) {
  const out = []; const queue = [rootDir];
  while (queue.length > 0) {
    const dir = queue.shift(); if (!dir) continue;
    const entries = await fs.readdir(dir, { withFileTypes: true }); entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name === '.DS_Store') continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (!entry.name.startsWith('.')) queue.push(abs); continue; }
      if (!entry.isFile()) continue;
      const kind = assetTypeForFile(abs); if (!kind) continue;
      out.push({ path: abs, kind }); if (limit > 0 && out.length >= limit) return out;
    }
  }
  return out;
}

export function buildDescription({ relDir, filename, descriptionPrefix, includeFilename }) {
  const parts = []; if (descriptionPrefix) parts.push(descriptionPrefix.trim());
  if (relDir && relDir !== '.') parts.push(`Subdirectories: ${relDir}`);
  if (includeFilename) parts.push(`Filename: ${filename}`);
  return parts.join(' | ').trim() || undefined;
}

export async function suggestAiMetadata({ apiBase, filePath, filename, folder, createFolder, existingTags, wantDisplayName, wantTags, tagCount }) {
  const form = new FormData(); const bytes = await fs.readFile(filePath); const mime = MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] || 'image/jpeg';
  form.append('file', new Blob([bytes], { type: mime }), filename); form.append('filename', filename);
  if (folder) form.append('folder', folder); if (createFolder) form.append('createFolder', 'true'); if (existingTags.length > 0) form.append('tags', existingTags.join(','));
  if (wantTags) { form.append('includeTags', 'true'); form.append('tagCount', String(tagCount)); } if (!wantDisplayName) form.append('skipDisplayName', 'true');
  const res = await fetch(`${apiBase}/api/display-name/suggest`, { method: 'POST', body: form }); const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload?.error || `AI metadata request failed (${res.status})`);
  return { displayName: typeof payload?.displayName === 'string' ? payload.displayName : undefined, tags: Array.isArray(payload?.tags) ? payload.tags.filter((t) => typeof t === 'string') : [], model: typeof payload?.model === 'string' ? payload.model : undefined };
}

export async function uploadImage({ apiBase, filePath, namespace, folder, createFolder, tags, description, displayName, sourcePath, originalUrl, duplicateAction, generateSemanticTags = true, semanticTagCount }) {
  const filename = path.basename(filePath); const mime = MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] || 'image/jpeg'; const bytes = await fs.readFile(filePath); const form = new FormData();
  form.append('file', new Blob([bytes], { type: mime }), filename); form.append('namespace', namespace); if (folder) form.append('folder', folder); if (createFolder) form.append('createFolder', 'true'); if (tags.length > 0) form.append('tags', tags.join(',')); if (description) form.append('description', description); if (displayName) form.append('displayName', displayName); form.append('sourceUrl', sourcePath); if (originalUrl) form.append('originalUrl', originalUrl); if (duplicateAction === 'family') form.append('duplicateAction', duplicateAction); if (generateSemanticTags === false) form.append('generateSemanticTags', 'false'); if (semanticTagCount !== undefined) form.append('semanticTagCount', String(semanticTagCount));
  const res = await fetch(`${apiBase}/api/upload`, { method: 'POST', body: form }); const payload = await res.json().catch(() => ({})); return { ok: res.ok, status: res.status, payload };
}

export async function uploadVideo({ apiBase, filePath, namespace, folder, createFolder, tags, description, sourcePath, originalUrl }) {
  const filename = path.basename(filePath); const mime = MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] || 'video/mp4'; const bytes = await fs.readFile(filePath); const form = new FormData();
  form.append('file', new Blob([bytes], { type: mime }), filename); form.append('namespace', namespace); if (folder) form.append('folder', folder); if (createFolder) form.append('createFolder', 'true'); if (tags.length > 0) form.append('tags', tags.join(',')); if (description) form.append('description', description); form.append('sourceUrl', sourcePath); if (originalUrl) form.append('originalUrl', originalUrl);
  const res = await fetch(`${apiBase}/api/import/page/upload-video`, { method: 'POST', body: form }); const payload = await res.json().catch(() => ({})); return { ok: res.ok, status: res.status, payload };
}

export async function patchImageExtras({ apiBase, imageId, flickrSource }) {
  const res = await fetch(`${apiBase}/api/images/${imageId}/extras`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ flickrSource }) });
  if (!res.ok) { const payload = await res.json().catch(() => ({})); throw new Error(payload?.error || `extras PATCH failed (${res.status})`); }
}

export function formatSourcePath(rootDir, filePath) { return `local://${path.relative(rootDir, filePath).split(path.sep).join('/')}`; }
