import { base64ToFile } from '@/components/image-uploader/fileHelpers';

const IMAGE_DATA_URL_PATTERN = /^data:(image\/[a-z0-9.+-]+)(?:;[a-z0-9.+-]+=[^;,]+)*;base64,([a-z0-9+/=\s]+)$/i;

const EXTENSION_BY_IMAGE_MIME: Record<string, string> = {
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'image/x-icon': 'ico',
};

export const isDataUrl = (value: string) => /^data:/i.test(value.trim());

export const createImageFileFromDataUrl = (value: string, filenameBase = 'pasted-image') => {
  const trimmed = value.trim();
  const match = trimmed.match(IMAGE_DATA_URL_PATTERN);
  if (!match) {
    throw new Error('Pasted data URLs must be base64 image data.');
  }

  const mimeType = match[1].toLowerCase();
  const base64 = match[2].replace(/\s/g, '');
  const extension = EXTENSION_BY_IMAGE_MIME[mimeType] || mimeType.split('/')[1]?.replace(/[^a-z0-9]+/gi, '-') || 'img';
  return base64ToFile(base64, `${filenameBase}.${extension}`, mimeType);
};
