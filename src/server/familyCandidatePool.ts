import { getCacheStats } from '@/server/cloudflareImageCache';
import {
  getImageExtrasRecords,
  getImageFolderOverrides,
  getImageFolderOverridesVersion,
} from '@/server/imageExtras';
import { getVideoAssetCatalogVersion } from '@/server/videoCatalogStorage';

// The adopt-variation candidate pool: every catalog asset projected down to
// the fields the adopt UI and the client-side candidate classification
// actually read. The full-fat FamilyAsset projection of the whole ~19k-image
// catalog serialized to ~95 MB; this slim projection exists so the candidates
// payload stays in single-digit megabytes.
//
// Two invariants:
// - Absent values are `undefined` (dropped by JSON.stringify), never empty
//   strings or empty arrays. The detail pages shallow-merge these records
//   over richer family/detail state; a present-but-empty key would clobber
//   real data.
// - `variants` is populated only for video assets. Image previews are built
//   from the id via getCloudflareImageUrl and never read `variants`.
export type SlimCandidateAsset = {
  id: string;
  assetType?: 'image' | 'video';
  namespace?: string;
  uploaded: string;
  filename: string;
  displayName?: string;
  folder?: string;
  tags?: string[];
  description?: string;
  altTag?: string;
  altText?: string;
  parentId?: string;
  linkedAssetId?: string;
  variationSort?: number;
  videoStatus?: 'pending' | 'ready' | 'error';
  videoThumbnailUrl?: string;
  videoPreviewUrl?: string;
  videoPlaybackUrl?: string;
  videoHlsUrl?: string;
  variants?: string[];
};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' ? value : undefined;

const asStringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.length > 0 ? (value as string[]) : undefined;

export const toSlimCandidateAsset = (record: Record<string, unknown>): SlimCandidateAsset => {
  const isVideo = record.assetType === 'video';
  return {
    id: String(record.id ?? ''),
    assetType: isVideo ? 'video' : 'image',
    namespace: asString(record.namespace),
    uploaded: typeof record.uploaded === 'string' ? record.uploaded : '',
    filename: typeof record.filename === 'string' ? record.filename : '',
    displayName: asString(record.displayName),
    folder: asString(record.folder),
    tags: asStringArray(record.tags),
    description: asString(record.description),
    altTag: asString(record.altTag),
    altText: asString(record.altText),
    parentId: asString(record.parentId),
    linkedAssetId: asString(record.linkedAssetId),
    variationSort: asNumber(record.variationSort),
    videoStatus: isVideo
      ? (record.videoStatus as 'pending' | 'ready' | 'error' | undefined)
      : undefined,
    videoThumbnailUrl: isVideo ? asString(record.videoThumbnailUrl) : undefined,
    videoPreviewUrl: isVideo ? asString(record.videoPreviewUrl) : undefined,
    videoPlaybackUrl: isVideo ? asString(record.videoPlaybackUrl) : undefined,
    videoHlsUrl: isVideo ? asString(record.videoHlsUrl) : undefined,
    variants: isVideo ? asStringArray(record.variants) : undefined,
  };
};

const POOL_MEMO_MAX_ENTRIES = 2;
const POOL_MEMO_CACHE_KEY = Symbol.for('photarium.familyCandidatePool.memo');
const poolMemoGlobal = globalThis as typeof globalThis & {
  [POOL_MEMO_CACHE_KEY]?: Map<string, SlimCandidateAsset[]>;
};
const poolMemoCache: Map<string, SlimCandidateAsset[]> =
  poolMemoGlobal[POOL_MEMO_CACHE_KEY] ?? new Map();
if (!poolMemoGlobal[POOL_MEMO_CACHE_KEY]) {
  poolMemoGlobal[POOL_MEMO_CACHE_KEY] = poolMemoCache;
}

export const clearFamilyCandidatePoolMemo = () => {
  poolMemoCache.clear();
};

const applyExtrasToSlimAssets = async (assets: SlimCandidateAsset[]): Promise<SlimCandidateAsset[]> => {
  const imageIds = assets
    .filter((asset) => asset.assetType !== 'video')
    .map((asset) => asset.id)
    .filter(Boolean);
  if (imageIds.length === 0) return assets;

  const extrasById = await getImageExtrasRecords(imageIds);
  return assets.map((asset) => {
    if (asset.assetType === 'video') return asset;
    const extras = extrasById[asset.id];
    if (!extras) return asset;
    const next = { ...asset };
    if (Object.prototype.hasOwnProperty.call(extras, 'folder')) {
      next.folder = asString(extras.folder);
    }
    if (Object.prototype.hasOwnProperty.call(extras, 'description')) {
      next.description = asString(extras.description);
    }
    if (Object.prototype.hasOwnProperty.call(extras, 'altText')) {
      next.altText = asString(extras.altText);
    }
    return next;
  });
};

// Builds (or serves from memo) the slim candidate pool for the family route.
// Keyed on the same version counters as the gallery memos, so reads never
// invalidate and any catalog/extras/video write serves a fresh pool.
export async function getFamilyCandidatePool(input: {
  images: Record<string, unknown>[];
  mappedVideos: Record<string, unknown>[];
  videoAssetsEnabled: boolean;
}): Promise<SlimCandidateAsset[]> {
  // Arm the folder-override version counter: applyFolderOverrideUpdate skips
  // the bump while the override map has never been loaded in this process, so
  // an unarmed counter would let extras writes serve a stale memoized pool.
  await getImageFolderOverrides();

  const stats = getCacheStats();
  const contentVersion = stats.contentVersion ?? stats.lastFetched ?? 0;
  const cacheKey = [
    contentVersion,
    getImageFolderOverridesVersion(),
    getVideoAssetCatalogVersion(),
    input.videoAssetsEnabled ? 'v1' : 'v0',
  ].join('|');

  const cached = poolMemoCache.get(cacheKey);
  if (cached) {
    poolMemoCache.delete(cacheKey);
    poolMemoCache.set(cacheKey, cached);
    return cached;
  }

  const seen = new Set<string>();
  const slim: SlimCandidateAsset[] = [];
  for (const record of [...input.images, ...input.mappedVideos]) {
    const asset = toSlimCandidateAsset(record);
    if (!asset.id || seen.has(asset.id)) continue;
    seen.add(asset.id);
    slim.push(asset);
  }

  const pool = await applyExtrasToSlimAssets(slim);

  poolMemoCache.set(cacheKey, pool);
  if (poolMemoCache.size > POOL_MEMO_MAX_ENTRIES) {
    const oldestKey = poolMemoCache.keys().next().value;
    if (oldestKey !== undefined) {
      poolMemoCache.delete(oldestKey);
    }
  }
  return pool;
}
