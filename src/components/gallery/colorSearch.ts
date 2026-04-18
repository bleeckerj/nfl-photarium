import type { CloudflareImage } from './types';

export type ColorSearchResultRow = {
  imageId?: string;
  id?: string;
  assetType?: 'image' | 'video';
  filename?: string;
  displayName?: string;
  folder?: string;
  namespace?: string;
  videoThumbnailUrl?: string;
  videoPlaybackUrl?: string;
};

export const normalizeColorSearchHex = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const normalized = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  if (!/^#[0-9a-fA-F]{6}$/.test(normalized)) {
    return null;
  }
  return normalized.toUpperCase();
};

export const resolveColorSearchAssets = (
  rows: ColorSearchResultRow[],
  images: CloudflareImage[]
): CloudflareImage[] => {
  const imageMap = new Map(images.map((image) => [image.id, image]));

  return rows.flatMap((row) => {
    const id = typeof row.imageId === 'string'
      ? row.imageId
      : typeof row.id === 'string'
        ? row.id
        : '';
    if (!id) return [];

    const existing = imageMap.get(id);
    if (existing) {
      return [existing];
    }

    const assetType = row.assetType === 'video' ? 'video' : 'image';
    const videoThumbnailUrl = typeof row.videoThumbnailUrl === 'string' ? row.videoThumbnailUrl : undefined;
    const videoPlaybackUrl = typeof row.videoPlaybackUrl === 'string' ? row.videoPlaybackUrl : undefined;

    return [{
      id,
      assetType,
      filename: row.filename || row.displayName || id,
      displayName: row.displayName,
      uploaded: '',
      variants: assetType === 'video'
        ? [videoThumbnailUrl, videoPlaybackUrl].filter((value): value is string => Boolean(value))
        : [],
      folder: row.folder,
      namespace: row.namespace,
      videoThumbnailUrl,
      videoPlaybackUrl,
    }];
  });
};
