import { PackagePlugin, PackagePluginInput, PackagePluginOutput } from './types';
import AdmZip from 'adm-zip';

const SUPPORTED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml'
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

const getMimeTypeFromFilename = (filename: string): string | undefined => {
  const lower = filename.toLowerCase();
  const match = Object.keys(MIME_BY_EXTENSION).find((ext) => lower.endsWith(ext));
  return match ? MIME_BY_EXTENSION[match] : undefined;
};

const normalizeFilename = (filename: string): string => {
  const parts = filename.split(/[\\/]/);
  return parts[parts.length - 1] || filename;
};

/**
 * Zip Plugin
 * Handles .zip archives
 * Extracts all image files from the archive
 */
export const zipPlugin: PackagePlugin = {
  name: 'ZIP Archive Plugin',
  extensions: ['.zip'],
  mimeTypes: ['application/zip', 'application/x-zip-compressed'],

  canHandle(filename: string, mimeType: string): boolean {
    const isZipExt = filename.toLowerCase().endsWith('.zip');
    const isZipMime = 
      mimeType === 'application/zip' || 
      mimeType === 'application/x-zip-compressed';
    return isZipExt || isZipMime;
  },

  async extract(input: PackagePluginInput): Promise<PackagePluginOutput> {
    const zip = new AdmZip(input.buffer);
    const entries = zip.getEntries();

    const assets = [];
    const skipped = [];

    for (const entry of entries) {
      if (entry.isDirectory) {
        continue;
      }

      const entryName = normalizeFilename(entry.entryName);
      const entryMime = getMimeTypeFromFilename(entryName);

      if (!entryMime || !SUPPORTED_IMAGE_TYPES.has(entryMime)) {
        skipped.push({ filename: entryName, reason: 'Not a supported image type' });
        continue;
      }

      assets.push({
        buffer: entry.getData(),
        filename: entryName,
      });
    }

    if (assets.length === 0) {
      throw new Error(
        `No image files found in ZIP archive. Skipped: ${skipped.map((s) => s.filename).join(', ')}`
      );
    }

    return {
      assets,
      tagOverride: 'zip',
    };
  },
};
