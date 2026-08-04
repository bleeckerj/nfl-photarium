import type { CachedCloudflareImage } from '@/server/cloudflareImageCacheMapper';
import type { VideoAssetRecord } from '@/server/videoCatalogStorage';
import type { GalleryQueryAsset } from '@/server/galleryQuery';
import {
  applyFolderOverridesToAssets,
  collectDirectFamilyAssets,
  matchesMediaFilter,
  matchesNamespace,
  mergeUniqueAssets,
  type ScopedAsset,
} from '@/server/galleryQueryRoute';
import {
  applyVideoAnimatedWebpComfyProvenance,
  buildVideoAnimatedWebpComfyProvenanceMap,
} from '@/server/videoAnimatedWebpComfyProvenance';

// Assembles the scoped asset list for a gallery request: video→image comfy
// provenance, namespace filtering, the video record projection, the family
// merge, the media filter, and folder overrides. All of these passes iterate
// the full catalog and depend only on version-counted inputs (image catalog,
// video catalog, folder-override map) plus the scope parameters — so the
// result is memoized under the caller-supplied version-keyed cacheKey, exactly
// like the scope/projection memos in galleryQuery.ts.

export interface ScopedAssemblyResult {
  scopedAssets: GalleryQueryAsset[];
  scopedImageIds: Set<string>;
  provenanceCount: number;
  filteredImageCount: number;
  familyAssetCount: number;
  mergedScopedCount: number;
  videoScopedCount: number;
  videoReturnedCount: number;
}

const ASSEMBLY_MEMO_MAX_ENTRIES = 8;
const ASSEMBLY_MEMO_CACHE_KEY = Symbol.for('photarium.galleryScopeAssembly.memo');
const assemblyMemoGlobal = globalThis as typeof globalThis & {
  [ASSEMBLY_MEMO_CACHE_KEY]?: Map<string, ScopedAssemblyResult>;
};
const assemblyMemoCache: Map<string, ScopedAssemblyResult> =
  assemblyMemoGlobal[ASSEMBLY_MEMO_CACHE_KEY] ?? new Map();
if (!assemblyMemoGlobal[ASSEMBLY_MEMO_CACHE_KEY]) {
  assemblyMemoGlobal[ASSEMBLY_MEMO_CACHE_KEY] = assemblyMemoCache;
}

export const clearGalleryScopeAssemblyMemo = () => {
  assemblyMemoCache.clear();
};

export const mapVideoToGalleryAsset = (video: VideoAssetRecord) => ({
  id: video.id,
  assetType: 'video' as const,
  generatedBy: typeof video.generatedBy === 'string' ? video.generatedBy : undefined,
  comfyMetadataDetected: Boolean(video.comfyMetadataDetected),
  comfyMetadataSource: typeof video.comfyMetadataSource === 'string' ? video.comfyMetadataSource : undefined,
  filename: video.filename,
  displayName: video.displayName || video.filename,
  uploaded: video.uploaded,
  variants: [
    video.animatedWebpUrl,
    video.thumbnailUrl,
    video.playbackUrl,
    video.hlsUrl,
  ].filter(Boolean) as string[],
  folder: video.folder,
  tags: video.tags,
  description: video.description,
  originalUrl: video.originalUrl,
  sourceUrl: video.sourceUrl,
  namespace: video.namespace,
  parentId: video.parentId,
  variationSort: video.variationSort,
  videoStatus: video.videoStatus,
  videoDurationSeconds: video.durationSeconds,
  videoPlaybackUrl: video.playbackUrl,
  videoHlsUrl: video.hlsUrl,
  videoThumbnailUrl: video.thumbnailUrl,
  videoPreviewUrl: video.previewUrl,
  videoAnimatedWebpUrl: video.animatedWebpUrl,
  hasClipEmbedding: video.hasClipEmbedding,
  dimensions: video.width && video.height
    ? { width: video.width, height: video.height }
    : undefined,
  aspectRatio: video.aspectRatio,
});

export const getScopedAssetAssembly = (options: {
  cacheKey: string;
  images: CachedCloudflareImage[];
  allVideos: VideoAssetRecord[];
  namespace: string | null;
  mediaFilter: string | null;
  includeFamilyFor: string;
  videoLimit: number;
  folderOverrides: Map<string, string | undefined> | null;
}): ScopedAssemblyResult => {
  const cached = assemblyMemoCache.get(options.cacheKey);
  if (cached) {
    assemblyMemoCache.delete(options.cacheKey);
    assemblyMemoCache.set(options.cacheKey, cached);
    return cached;
  }

  const {
    images, allVideos, namespace, mediaFilter, includeFamilyFor, videoLimit, folderOverrides,
  } = options;

  const provenance = buildVideoAnimatedWebpComfyProvenanceMap(allVideos);
  const imagesWithVideoProvenance = applyVideoAnimatedWebpComfyProvenance(images, provenance);
  const filteredImages = imagesWithVideoProvenance.filter((image) =>
    matchesNamespace(image.namespace, namespace)
  );

  const mappedVideos = allVideos.map(mapVideoToGalleryAsset);
  const scopedVideos = mappedVideos.filter((video) => matchesNamespace(video.namespace, namespace));
  const limitedVideos = scopedVideos.slice(0, videoLimit);

  const familyAssets = includeFamilyFor
    ? collectDirectFamilyAssets([...imagesWithVideoProvenance, ...mappedVideos], includeFamilyFor)
    : [];
  const mergedScopedAssets = mergeUniqueAssets(
    [...filteredImages, ...limitedVideos] as Array<{ id: string }>,
    familyAssets as Array<{ id: string }>
  );
  const scopedBeforeOverrides = mergedScopedAssets.filter((asset) =>
    matchesMediaFilter(asset as ScopedAsset, mediaFilter)
  ) as GalleryQueryAsset[];
  const scopedAssets = folderOverrides && folderOverrides.size > 0
    ? applyFolderOverridesToAssets(scopedBeforeOverrides, folderOverrides)
    : scopedBeforeOverrides;
  const scopedImageIds = new Set(
    scopedAssets
      .filter((asset) => asset.assetType !== 'video')
      .map((asset) => asset.id)
  );

  const result: ScopedAssemblyResult = {
    scopedAssets,
    scopedImageIds,
    provenanceCount: provenance.size,
    filteredImageCount: filteredImages.length,
    familyAssetCount: familyAssets.length,
    mergedScopedCount: mergedScopedAssets.length,
    videoScopedCount: scopedVideos.length,
    videoReturnedCount: limitedVideos.length,
  };

  if (assemblyMemoCache.size >= ASSEMBLY_MEMO_MAX_ENTRIES) {
    const oldest = assemblyMemoCache.keys().next().value;
    if (oldest !== undefined) assemblyMemoCache.delete(oldest);
  }
  assemblyMemoCache.set(options.cacheKey, result);
  return result;
};
