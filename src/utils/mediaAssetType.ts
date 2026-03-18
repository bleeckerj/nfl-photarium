export type MediaAssetType = 'image' | 'video';

const VIDEO_URL_PATTERN = /\.(mp4|webm|mov|m4v|ogv|ogg)(\?|$)/i;

export const inferAssetTypeFromUrl = (value?: string): MediaAssetType => {
  if (!value) return 'image';
  if (/^blob:/i.test(value)) return 'video';
  return VIDEO_URL_PATTERN.test(value) ? 'video' : 'image';
};

export const isImageOnlyImportError = (message?: string): boolean => {
  if (!message) return false;
  return /must point to an image|supported image|valid image url/i.test(message);
};
