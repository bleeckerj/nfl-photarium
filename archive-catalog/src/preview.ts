import { execFile } from 'node:child_process';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getAsset } from './search.js';

const execFileAsync = promisify(execFile);

export interface PreviewInfo {
  assetId: string;
  path: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  createdAt: string;
}

async function embeddedPreview(sourcePath: string): Promise<Buffer | null> {
  for (const field of ['-PreviewImage', '-JpgFromRaw', '-ThumbnailImage']) {
    try {
      const result = await execFileAsync('exiftool', ['-b', field, sourcePath], { encoding: 'buffer', maxBuffer: 50 * 1024 * 1024 });
      const buffer = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout);
      if (buffer.length) return buffer;
    } catch {
      // Try the next embedded representation.
    }
  }
  return null;
}

async function renderPreview(sourcePath: string): Promise<{ data: Buffer; width: number | null; height: number | null }> {
  const sharpModule = await import('sharp');
  const sharp = sharpModule.default;
  const extension = sourcePath.toLowerCase().split('.').pop() ?? '';
  const raw = ['dng', 'cr2', 'cr3', 'nef', 'arw', 'orf', 'raf', 'rw2', 'psd'].includes(extension)
    ? await embeddedPreview(sourcePath)
    : null;
  const image = sharp(raw ?? sourcePath, { failOn: 'none' });
  const output = await image.rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 84 }).toBuffer({ resolveWithObject: true });
  return { data: output.data, width: output.info.width ?? null, height: output.info.height ?? null };
}

export async function ensurePreview(database: DatabaseSync, assetId: string, previewRoot: string): Promise<PreviewInfo | null> {
  const existing = database.prepare('SELECT asset_id AS assetId, path, mime_type AS mimeType, width, height, created_at AS createdAt FROM previews WHERE asset_id = ? AND kind = ?').get(assetId, 'thumbnail') as PreviewInfo | undefined;
  if (existing) {
    try {
      await stat(existing.path);
      return existing;
    } catch {
      database.prepare('DELETE FROM previews WHERE asset_id = ? AND kind = ?').run(assetId, 'thumbnail');
    }
  }
  const asset = getAsset(database, assetId);
  if (!asset?.sourceAvailable || !asset.absolutePath) return null;
  await mkdir(previewRoot, { recursive: true });
  let rendered: Awaited<ReturnType<typeof renderPreview>>;
  try {
    rendered = await renderPreview(asset.absolutePath);
  } catch {
    return null;
  }
  const previewPath = join(previewRoot, `${assetId}.jpg`);
  await import('node:fs/promises').then(({ writeFile }) => writeFile(previewPath, rendered.data));
  const createdAt = new Date().toISOString();
  database.prepare(`
    INSERT INTO previews(asset_id, kind, path, mime_type, width, height, source_mtime, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(asset_id, kind) DO UPDATE SET path = excluded.path, mime_type = excluded.mime_type, width = excluded.width, height = excluded.height, source_mtime = excluded.source_mtime, created_at = excluded.created_at
  `).run(assetId, 'thumbnail', previewPath, 'image/jpeg', rendered.width, rendered.height, asset.sourceMtime, createdAt);
  return { assetId, path: previewPath, mimeType: 'image/jpeg', width: rendered.width, height: rendered.height, createdAt };
}

export async function readPreview(info: PreviewInfo): Promise<Buffer> {
  return readFile(info.path);
}
