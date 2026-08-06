import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';

const execFileAsync = promisify(execFile);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.avif', '.dng']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.m4v', '.ogv', '.ogg']);

export function createSerializedTaskQueue() {
  let chain = Promise.resolve();
  return async (task) => { const next = chain.then(task); chain = next.catch(() => {}); return next; };
}

export async function walkMediaFiles(rootDir, { limit = 0 } = {}) {
  const out = [];
  const queue = [rootDir];
  while (queue.length > 0) {
    const dir = queue.shift();
    if (!dir) continue;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name === '.DS_Store') continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (!entry.name.startsWith('.')) queue.push(abs); continue; }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(ext) && !VIDEO_EXTENSIONS.has(ext)) continue;
      out.push({ path: abs, kind: VIDEO_EXTENSIONS.has(ext) ? 'video' : 'image' });
      if (limit > 0 && out.length >= limit) return out;
    }
  }
  return out;
}

export function buildDescription({ relDir, filename, relPath, absolutePath, descriptionPrefix, includeFilename }) {
  const parts = [];
  if (descriptionPrefix) parts.push(descriptionPrefix.trim());
  if (relDir && relDir !== '.') parts.push(`Subdirectories: ${relDir}`);
  if (includeFilename) parts.push(`Filename: ${filename}`);
  parts.push(`Raw source: local://${absolutePath.split(path.sep).join('/')}`);
  if (relPath) parts.push(`Relative source: local://${relPath.split(path.sep).join('/')}`);
  return parts.join(' | ').trim() || undefined;
}

export async function hashFileContent(filePath) {
  return createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
}

export async function createPreviewBuffer(filePath, { previewMax, previewFormat, quality }) {
  try {
    let pipeline = sharp(filePath, { limitInputPixels: false }).rotate();
    if (previewMax !== 'original') pipeline = pipeline.resize({ width: previewMax, height: previewMax, fit: 'inside', withoutEnlargement: true });
    pipeline = previewFormat === 'webp' ? pipeline.webp({ quality }) : pipeline.jpeg({ quality, mozjpeg: true });
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    return { buffer: data, width: info.width, height: info.height, size: data.byteLength, method: 'sharp', format: previewFormat, mime: previewFormat === 'webp' ? 'image/webp' : 'image/jpeg' };
  } catch (sharpError) {
    const tmpDir = path.resolve('tmp', 'dng-ingest-previews');
    await fs.mkdir(tmpDir, { recursive: true });
    const tmpOut = path.join(tmpDir, `${createHash('sha1').update(filePath).digest('hex').slice(0, 16)}.jpg`);
    try {
      await execFileAsync('sips', ['-s', 'format', 'jpeg', ...(previewMax === 'original' ? [] : ['--resampleHeightWidthMax', String(previewMax)]), filePath, '--out', tmpOut]);
      const data = await fs.readFile(tmpOut);
      if (previewFormat === 'webp') {
        const { data: webpData, info: webpInfo } = await sharp(data).webp({ quality }).toBuffer({ resolveWithObject: true });
        return { buffer: webpData, width: webpInfo.width, height: webpInfo.height, size: webpData.byteLength, method: 'sips+sharp', format: 'webp', mime: 'image/webp' };
      }
      const info = await sharp(data).metadata();
      return { buffer: data, width: info.width, height: info.height, size: data.byteLength, method: 'sips', format: 'jpeg', mime: 'image/jpeg' };
    } catch (fallbackError) {
      throw new Error(`Preview generation failed (sharp: ${sharpError instanceof Error ? sharpError.message : String(sharpError)}; sips: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)})`);
    }
  }
}
