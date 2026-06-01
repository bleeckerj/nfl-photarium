import type { GalleryQueryAsset, GalleryQueryFilters } from '@/server/galleryQuery';

export type ListableImage = {
  id: string;
  assetType?: 'image' | 'video';
  filename: string;
  displayName?: string;
  uploaded: string;
  variants: string[];
  size?: number;
  isAnimated?: boolean;
  folder?: string;
  tags?: string[];
  description?: string;
  aspectRatio?: string;
  dimensions?: { width: number; height: number };
  altTag?: string;
  altText?: string;
  parentId?: string;
  variationSort?: number;
  linkedAssetId?: string;
  originalUrl?: string;
  originalUrlNormalized?: string;
  sourceUrl?: string;
  sourceUrlNormalized?: string;
  promptThis?: string;
  namespace?: string;
  generatedBy?: string;
  comfyMetadataDetected?: boolean;
  comfyMetadataSource?: string;
  videoStatus?: 'pending' | 'ready' | 'error';
  videoDurationSeconds?: number;
  videoPlaybackUrl?: string;
  videoHlsUrl?: string;
  videoThumbnailUrl?: string;
  videoPreviewUrl?: string;
  videoAnimatedWebpUrl?: string;
  hasClipEmbedding?: boolean;
  hasColorEmbedding?: boolean;
  dominantColors?: string[];
  averageColor?: string;
};

type FamilyAsset = {
  id: string;
  parentId?: string;
  namespace?: string;
  assetType?: 'image' | 'video';
};

export type ScopedAsset =
  | {
      id: string;
      assetType?: 'image';
      filename?: string;
      tags?: string[];
      isAnimated?: boolean;
    }
  | {
      id: string;
      assetType: 'video';
      filename: string;
      tags?: string[];
      isAnimated?: boolean;
    };

export const matchesNamespace = (assetNamespace: string | undefined, namespace: string | null) => {
  if (namespace === null) return true;
  if (namespace === '') return !assetNamespace;
  return assetNamespace === namespace;
};

export const mergeUniqueAssets = <T extends { id: string }>(base: T[], extras: T[]) => {
  const merged = [...base];
  const seen = new Set(base.map((asset) => asset.id));
  for (const asset of extras) {
    if (seen.has(asset.id)) continue;
    seen.add(asset.id);
    merged.push(asset);
  }
  return merged;
};

export const collectDirectFamilyAssets = <T extends FamilyAsset>(assets: T[], targetId: string) => {
  if (!targetId) return [] as T[];
  const target = assets.find((asset) => asset.id === targetId);
  if (!target) return [] as T[];

  const familyRootId = target.parentId || target.id;
  return assets.filter((asset) => {
    if (asset.id === target.id) return true;
    if (asset.id === familyRootId) return true;
    return asset.parentId === familyRootId;
  });
};

const hasTag = (tags: string[] | undefined, expected: string) =>
  Array.isArray(tags) && tags.some((tag) => tag.trim().toLowerCase() === expected);

const isExplicitAnimatedWebpImage = (asset: ScopedAsset) => {
  if (asset.assetType === 'video') return false;
  if (asset.isAnimated === true) return true;
  const filename = typeof asset.filename === 'string' ? asset.filename.trim().toLowerCase() : '';
  const tags = Array.isArray(asset.tags) ? asset.tags : [];
  if (hasTag(tags, 'animated-webp')) return true;
  // Backward compatibility for older /api/animate outputs that were saved as
  // `animated-*.webp` but were not tagged as animated WebP artifacts.
  if (filename.endsWith('.webp') && /(^|[-_])animated([-_]|$)/i.test(filename)) return true;
  return filename.endsWith('.webp') && hasTag(tags, 'video-derivative');
};

export const matchesMediaFilter = (asset: ScopedAsset, mediaFilter: string | null) => {
  if (mediaFilter !== 'animated') return true;
  if (asset.assetType === 'video') return true;
  return isExplicitAnimatedWebpImage(asset);
};

export const parseBooleanParam = (value: string | null) => value === '1' || value === 'true';

export const parseCsvParam = (value: string | null): string[] =>
  value
    ? value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];

export const parseAspectClasses = (value: string | null): Array<'horizontal' | 'vertical' | 'square'> =>
  parseCsvParam(value).filter(
    (entry): entry is 'horizontal' | 'vertical' | 'square' =>
      entry === 'horizontal' || entry === 'vertical' || entry === 'square'
  );

export const parseEmbeddingFilter = (value: string | null): GalleryQueryFilters['embedding'] => {
  if (
    value === 'missing-clip' ||
    value === 'missing-color' ||
    value === 'missing-any' ||
    value === 'missing-both'
  ) {
    return value;
  }
  return 'none';
};

export const applyFolderOverridesToAssets = <T extends GalleryQueryAsset>(
  assets: T[],
  overrides: Map<string, string | undefined>
): T[] => {
  if (overrides.size === 0) return assets;
  return assets.map((asset) => {
    if (asset.assetType === 'video') return asset;
    if (!overrides.has(asset.id)) return asset;
    return {
      ...asset,
      folder: overrides.get(asset.id),
    };
  });
};

export function toListableImage(image: Record<string, unknown>): ListableImage {
  const rawDimensions = image.dimensions as { width?: unknown; height?: unknown } | undefined;
  const width = typeof rawDimensions?.width === 'number' ? rawDimensions.width : undefined;
  const height = typeof rawDimensions?.height === 'number' ? rawDimensions.height : undefined;
  const dimensions = width && height ? { width, height } : undefined;

  // Intentionally omit heavy fields like EXIF from the gallery list payload.
  return {
    id: String(image.id ?? ''),
    assetType: image.assetType === 'video' ? 'video' : 'image',
    filename: typeof image.filename === 'string' ? image.filename : '',
    displayName: typeof image.displayName === 'string' ? image.displayName : undefined,
    uploaded: typeof image.uploaded === 'string' ? image.uploaded : '',
    variants: Array.isArray(image.variants) ? (image.variants as string[]) : [],
    size: typeof image.size === 'number' ? image.size : undefined,
    isAnimated: image.isAnimated === true,
    folder: typeof image.folder === 'string' ? image.folder : undefined,
    tags: Array.isArray(image.tags) ? (image.tags as string[]) : undefined,
    description: typeof image.description === 'string' ? image.description : undefined,
    aspectRatio: typeof image.aspectRatio === 'string' ? image.aspectRatio : undefined,
    dimensions,
    altTag: typeof image.altTag === 'string' ? image.altTag : undefined,
    altText: typeof image.altText === 'string' ? image.altText : undefined,
    parentId: typeof image.parentId === 'string' ? image.parentId : undefined,
    variationSort: typeof image.variationSort === 'number' ? image.variationSort : undefined,
    linkedAssetId: typeof image.linkedAssetId === 'string' ? image.linkedAssetId : undefined,
    originalUrl: typeof image.originalUrl === 'string' ? image.originalUrl : undefined,
    originalUrlNormalized: typeof image.originalUrlNormalized === 'string' ? image.originalUrlNormalized : undefined,
    sourceUrl: typeof image.sourceUrl === 'string' ? image.sourceUrl : undefined,
    sourceUrlNormalized: typeof image.sourceUrlNormalized === 'string' ? image.sourceUrlNormalized : undefined,
    promptThis: typeof image.promptThis === 'string' ? image.promptThis : undefined,
    namespace: typeof image.namespace === 'string' ? image.namespace : undefined,
    generatedBy: typeof image.generatedBy === 'string' ? image.generatedBy : undefined,
    comfyMetadataDetected: Boolean(image.comfyMetadataDetected),
    comfyMetadataSource: typeof image.comfyMetadataSource === 'string' ? image.comfyMetadataSource : undefined,
    videoStatus: image.videoStatus as 'pending' | 'ready' | 'error' | undefined,
    videoDurationSeconds: typeof image.videoDurationSeconds === 'number' ? image.videoDurationSeconds : undefined,
    videoPlaybackUrl: typeof image.videoPlaybackUrl === 'string' ? image.videoPlaybackUrl : undefined,
    videoHlsUrl: typeof image.videoHlsUrl === 'string' ? image.videoHlsUrl : undefined,
    videoThumbnailUrl: typeof image.videoThumbnailUrl === 'string' ? image.videoThumbnailUrl : undefined,
    videoPreviewUrl: typeof image.videoPreviewUrl === 'string' ? image.videoPreviewUrl : undefined,
    videoAnimatedWebpUrl: typeof image.videoAnimatedWebpUrl === 'string' ? image.videoAnimatedWebpUrl : undefined,
    hasClipEmbedding: typeof image.hasClipEmbedding === 'boolean' ? image.hasClipEmbedding : undefined,
    hasColorEmbedding: typeof image.hasColorEmbedding === 'boolean' ? image.hasColorEmbedding : undefined,
    dominantColors: Array.isArray(image.dominantColors) ? (image.dominantColors as string[]) : undefined,
    averageColor: typeof image.averageColor === 'string' ? image.averageColor : undefined,
  };
}
