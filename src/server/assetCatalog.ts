import { getCachedImages } from '@/server/cloudflareImageCache';
import {
  listVideoAssetRecords,
  listVideoAssetRecordsWithSync,
  type VideoAssetRecord,
} from '@/server/videoCatalogStorage';

export type CatalogAsset = {
  id: string;
  assetType: 'image' | 'video';
  filename: string;
  uploaded: string;
  parentId?: string;
  variationSort?: number;
};

const toCatalogVideo = (video: VideoAssetRecord): CatalogAsset => ({
  id: video.id,
  assetType: 'video',
  filename: video.filename,
  uploaded: video.uploaded,
  parentId: video.parentId,
  variationSort: video.variationSort,
});

const VIDEO_LIST_TIMEOUT_MS = Math.max(
  1_000,
  Number(process.env.ASSET_CATALOG_VIDEO_TIMEOUT_MS ?? 4_000)
);

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  let timeoutId: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

export async function listCatalogAssets(options?: {
  forceRefreshImages?: boolean;
  syncVideos?: boolean;
  includeVideos?: boolean;
}): Promise<CatalogAsset[]> {
  const images = await getCachedImages(options?.forceRefreshImages === true);
  const includeVideos = options?.includeVideos !== false && process.env.ENABLE_VIDEO_ASSETS === '1';
  let videos: VideoAssetRecord[] = [];
  if (includeVideos) {
    try {
      videos = await withTimeout(
        options?.syncVideos ? listVideoAssetRecordsWithSync() : listVideoAssetRecords(),
        VIDEO_LIST_TIMEOUT_MS,
        'Video asset catalog load'
      );
    } catch (error) {
      console.warn('[assetCatalog] Falling back to image-only catalog due to video load failure', {
        error: error instanceof Error ? error.message : String(error),
      });
      videos = [];
    }
  }

  const mappedImages: CatalogAsset[] = images.map((image) => ({
    id: image.id,
    assetType: 'image',
    filename: image.filename,
    uploaded: image.uploaded,
    parentId: image.parentId,
    variationSort: image.variationSort,
  }));

  return [...mappedImages, ...videos.map(toCatalogVideo)];
}

export async function getCatalogAssetById(
  id: string,
  options?: {
    forceRefreshImages?: boolean;
    syncVideos?: boolean;
  }
): Promise<CatalogAsset | null> {
  const assets = await listCatalogAssets(options);
  return assets.find((asset) => asset.id === id) || null;
}
