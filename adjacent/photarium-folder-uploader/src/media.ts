import path from 'node:path';

export const DEFAULT_MEDIA_EXTENSIONS = [
  '.avif',
  '.gif',
  '.heic',
  '.jpeg',
  '.jpg',
  '.m4v',
  '.mov',
  '.mp4',
  '.ogg',
  '.ogv',
  '.png',
  '.tif',
  '.tiff',
  '.webm',
  '.webp',
] as const;

export type MediaType = 'image' | 'video';

const IMAGE_EXTENSIONS = new Set([
  '.avif',
  '.gif',
  '.heic',
  '.jpeg',
  '.jpg',
  '.png',
  '.tif',
  '.tiff',
  '.webp',
]);

const VIDEO_EXTENSIONS = new Set(['.m4v', '.mov', '.mp4', '.ogg', '.ogv', '.webm']);

const MIME_BY_EXTENSION: Record<string, string> = {
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mp4': 'video/mp4',
  '.ogg': 'video/ogg',
  '.ogv': 'video/ogg',
  '.png': 'image/png',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
};

export function mediaTypeForPath(filePath: string, extensions?: string[]): MediaType | null {
  const extension = path.extname(filePath).toLowerCase();
  if (extensions && !extensions.includes(extension)) return null;
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  return null;
}

export function mimeTypeForPath(filePath: string): string {
  return MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}
