import { NextRequest, NextResponse } from 'next/server';
import { getCachedImages, getCacheStats } from '@/server/cloudflareImageCache';
import { batchGetAspectMetadata, batchGetColorMetadata, isVectorSearchAvailable } from '@/server/vectorSearch';
import { listVideoAssetRecordsWithSync } from '@/server/videoCatalogStorage';
import {
  getImageExtrasRecords,
  getImageFolderOverrides,
  getImageFolderOverridesVersion,
} from '@/server/imageExtras';
import { queryGalleryAssets, type GalleryQueryAsset, type GalleryQueryFilters } from '@/server/galleryQuery';

type ListableImage = {
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

type ScopedAsset =
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

const matchesNamespace = (assetNamespace: string | undefined, namespace: string | null) => {
  if (namespace === null) return true;
  if (namespace === '') return !assetNamespace;
  return assetNamespace === namespace;
};

const mergeUniqueAssets = <T extends { id: string }>(base: T[], extras: T[]) => {
  const merged = [...base];
  const seen = new Set(base.map((asset) => asset.id));
  for (const asset of extras) {
    if (seen.has(asset.id)) continue;
    seen.add(asset.id);
    merged.push(asset);
  }
  return merged;
};

const collectDirectFamilyAssets = <T extends FamilyAsset>(assets: T[], targetId: string) => {
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

const matchesMediaFilter = (asset: ScopedAsset, mediaFilter: string | null) => {
  if (mediaFilter !== 'animated') return true;
  if (asset.assetType === 'video') return true;
  return isExplicitAnimatedWebpImage(asset);
};

const parseBooleanParam = (value: string | null) => value === '1' || value === 'true';

const parseCsvParam = (value: string | null): string[] =>
  value
    ? value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];

const parseAspectClasses = (value: string | null): Array<'horizontal' | 'vertical' | 'square'> =>
  parseCsvParam(value).filter(
    (entry): entry is 'horizontal' | 'vertical' | 'square' =>
      entry === 'horizontal' || entry === 'vertical' || entry === 'square'
  );

const parseEmbeddingFilter = (value: string | null): GalleryQueryFilters['embedding'] => {
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

const isImageAsset = (asset: GalleryQueryAsset) =>
  asset.assetType !== 'video';

const applyFolderOverridesToAssets = <T extends GalleryQueryAsset>(
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

function toListableImage(image: Record<string, unknown>): ListableImage {
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

export async function GET(request: NextRequest) {
  const startedAt = performance.now();
  const mark = (value: number) => Number(value.toFixed(1));
  const timings: Record<string, number> = {};
  const diagnostics: Record<string, number | boolean | string | null> = {};
  const markStage = <T,>(label: string, fn: () => Promise<T> | T): Promise<T> | T => {
    const stageStartedAt = performance.now();
    const finalize = () => {
      timings[label] = mark(performance.now() - stageStartedAt);
    };
    try {
      const value = fn();
      if (value instanceof Promise) {
        return value.finally(finalize);
      }
      finalize();
      return value;
    } catch (error) {
      finalize();
      throw error;
    }
  };

  try {
    const forceRefresh = request.nextUrl.searchParams.get('refresh') === '1';
    const includeVectorMeta = request.nextUrl.searchParams.get('includeVectorMeta') === '1';
    const includeExtras = request.nextUrl.searchParams.get('includeExtras') === '1';
    const includeFamilyFor = request.nextUrl.searchParams.get('includeFamilyFor')?.trim() || '';
    const aspectRatioClass = request.nextUrl.searchParams.get('aspectRatioClass')?.trim();
    const aspectRatio = request.nextUrl.searchParams.get('aspectRatio')?.trim();
    const mediaFilter = request.nextUrl.searchParams.get('mediaFilter')?.trim().toLowerCase() || null;
    const search = request.nextUrl.searchParams.get('search')?.trim() || '';
    const folder = request.nextUrl.searchParams.get('folder')?.trim() || '';
    const tag = request.nextUrl.searchParams.get('tag')?.trim() || '';
    const onlyCanonical = parseBooleanParam(request.nextUrl.searchParams.get('onlyCanonical'));
    const onlyWithVariants = parseBooleanParam(request.nextUrl.searchParams.get('onlyWithVariants'));
    const favorites = parseBooleanParam(request.nextUrl.searchParams.get('favorites'));
    const duplicates = parseBooleanParam(request.nextUrl.searchParams.get('duplicates'));
    const comfy = parseBooleanParam(request.nextUrl.searchParams.get('comfy'));
    const embedding = parseEmbeddingFilter(request.nextUrl.searchParams.get('embedding'));
    const aspectRatioClasses = parseAspectClasses(request.nextUrl.searchParams.get('aspectRatioClasses'));
    const dateStart = request.nextUrl.searchParams.get('dateStart')?.trim() || '';
    const dateEnd = request.nextUrl.searchParams.get('dateEnd')?.trim() || '';
    const hiddenFolders = parseCsvParam(request.nextUrl.searchParams.get('hiddenFolders'));
    const hiddenTags = parseCsvParam(request.nextUrl.searchParams.get('hiddenTags'));
    const focusAssetId = request.nextUrl.searchParams.get('focus')?.trim() || '';
    const namespaceParam = request.nextUrl.searchParams.get('namespace');
    const videoLimitParam = request.nextUrl.searchParams.get('videoLimit');
    const pageParam = request.nextUrl.searchParams.get('page');
    const pageSizeParam = request.nextUrl.searchParams.get('pageSize');
    const defaultNamespace = process.env.IMAGE_NAMESPACE || process.env.NEXT_PUBLIC_IMAGE_NAMESPACE || '';
    const namespace =
      namespaceParam === '__none__'
        ? ''
        : namespaceParam === '__all__'
          ? null
          : namespaceParam !== null
            ? namespaceParam.trim()
            : defaultNamespace;
    // Kick off all three I/O-bound loads concurrently. They are independent:
    // the image cache, the video catalog, and the folder-override map do not
    // depend on each other's results. Awaiting them serially adds their
    // latencies together; awaiting them in parallel makes total I/O time
    // bounded by the slowest of the three. On a warm process all three are
    // ~tens of ms; on a cold process this saves whichever pair would have
    // run sequentially.
    const folderOverridesPromise = getImageFolderOverrides();
    folderOverridesPromise.catch((error) => {
      console.warn('[ImagesAPI] Folder override warm failed:', error);
    });

    const cachePromise = markStage('cache_load', () => getCachedImages(forceRefresh));

    const videoAssetsEnabled = process.env.ENABLE_VIDEO_ASSETS === '1';
    const configuredVideoLimit = Number(process.env.VIDEO_ASSET_LIST_LIMIT ?? 300);
    const parsedVideoLimit = videoLimitParam ? Number(videoLimitParam) : configuredVideoLimit;
    const videoLimit = Number.isFinite(parsedVideoLimit) && parsedVideoLimit > 0
      ? Math.floor(parsedVideoLimit)
      : 300;
    const videosPromise = videoAssetsEnabled
      ? markStage('videos_load', () => listVideoAssetRecordsWithSync())
      : Promise.resolve([] as Awaited<ReturnType<typeof listVideoAssetRecordsWithSync>>);

    const images = await cachePromise;
    const filteredImages = images.filter((image) => matchesNamespace(image.namespace, namespace));
    diagnostics.filtered_image_count = filteredImages.length;

    const allVideos = await videosPromise;
    const mappedVideos = allVideos.map((video) => ({
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
      ].filter(Boolean),
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
    }));
    const scopedVideos = mappedVideos.filter((video) => matchesNamespace(video.namespace, namespace));
    const limitedVideos = scopedVideos.slice(0, videoLimit);
    diagnostics.video_scoped_count = scopedVideos.length;
    diagnostics.video_returned_count = limitedVideos.length;
    const videoMeta = {
      enabled: videoAssetsEnabled,
      limit: videoLimit,
      returned: limitedVideos.length,
      totalScoped: scopedVideos.length,
      truncated: scopedVideos.length > limitedVideos.length,
    };
    const familyAssets = includeFamilyFor
      ? await markStage('family_collect', () => collectDirectFamilyAssets([...images, ...mappedVideos], includeFamilyFor))
      : [];
    const mergedScopedAssets = mergeUniqueAssets(
      [...filteredImages, ...limitedVideos],
      familyAssets
    );
    const scopedAssets = mergedScopedAssets.filter((asset) => matchesMediaFilter(asset as ScopedAsset, mediaFilter));
    diagnostics.family_asset_count = familyAssets.length;
    diagnostics.media_filter = mediaFilter;
    diagnostics.scoped_asset_count = scopedAssets.length;
    diagnostics.scoped_asset_count_before_media_filter = mergedScopedAssets.length;
    const scopedImageIds = new Set(
      scopedAssets
        .filter((asset) => !('assetType' in asset) || asset.assetType !== 'video')
        .map((asset) => asset.id)
    );
    diagnostics.scoped_image_count = scopedImageIds.size;
    
    // Optional: merge embedding status from Redis.
    // Keep this off by default so gallery can render immediately and enrich asynchronously.
    let imagesWithEmbeddings = images.filter((image) => scopedImageIds.has(image.id));
    if (includeVectorMeta) {
      try {
        const redisCheckStart = performance.now();
        const redisAvailable = await isVectorSearchAvailable();
        timings.redis_check = mark(performance.now() - redisCheckStart);

        if (redisAvailable && imagesWithEmbeddings.length > 0) {
          const redisBatchStart = performance.now();
          const imageIds = imagesWithEmbeddings.map(img => img.id);
          const [colorMetadata, aspectMetadata] = await Promise.all([
            batchGetColorMetadata(imageIds),
            batchGetAspectMetadata(imageIds),
          ]);
          timings.redis_batch = mark(performance.now() - redisBatchStart);
          diagnostics.redis_image_count = imageIds.length;
          
          imagesWithEmbeddings = imagesWithEmbeddings.map(img => {
            const meta = colorMetadata.get(img.id);
            const aspect = aspectMetadata.get(img.id);
            if (meta) {
              return {
                ...img,
                hasClipEmbedding: meta.hasClipEmbedding,
                hasColorEmbedding: meta.hasColorEmbedding,
                dominantColors: meta.dominantColors ?? img.dominantColors,
                averageColor: meta.averageColor ?? img.averageColor,
                aspectRatio: aspect?.aspectRatio ?? img.aspectRatio,
                dimensions: aspect?.width && aspect?.height
                  ? { width: aspect.width, height: aspect.height }
                  : img.dimensions,
              };
            }
            if (aspect) {
              return {
                ...img,
                aspectRatio: aspect.aspectRatio ?? img.aspectRatio,
                dimensions: aspect.width && aspect.height
                  ? { width: aspect.width, height: aspect.height }
                  : img.dimensions,
              };
            }
            return img;
          });
        }
      } catch (redisError) {
        // Redis not available, continue without embedding status
        console.warn('[ImagesAPI] Redis unavailable for embedding status:', redisError);
      }
    }
    
    const enrichedImageMap = new Map(imagesWithEmbeddings.map((image) => [image.id, image]));
    const finalAssetsBeforeQuery = scopedAssets.map((asset) => {
      if ('assetType' in asset && asset.assetType === 'video') {
        return asset;
      }
      return enrichedImageMap.get(asset.id) ?? asset;
    });
    let finalImages: GalleryQueryAsset[] = finalAssetsBeforeQuery as GalleryQueryAsset[];
    const parsedPage = pageParam ? Number(pageParam) : NaN;
    const parsedPageSize = pageSizeParam ? Number(pageSizeParam) : NaN;
    const hasPagination = Number.isFinite(parsedPage) || Number.isFinite(parsedPageSize);
    const page = Number.isFinite(parsedPage) && parsedPage > 0 ? Math.floor(parsedPage) : 1;
    const pageSize = Number.isFinite(parsedPageSize) && parsedPageSize > 0
      ? Math.min(500, Math.floor(parsedPageSize))
      : 60;
    const hasGalleryQueryParams = Boolean(
      search ||
      folder ||
      tag ||
      onlyCanonical ||
      onlyWithVariants ||
      favorites ||
      duplicates ||
      comfy ||
      embedding !== 'none' ||
      aspectRatioClasses.length > 0 ||
      dateStart ||
      dateEnd ||
      hiddenFolders.length > 0 ||
      hiddenTags.length > 0
    );
    const hasFocusQuery = Boolean(focusAssetId);
    // Folder filtering, hidden-folder filtering, and folder facets all need the
    // extras-stored folder for each image. We used to MGET the entire extras
    // dataset (~18k keys, ~270ms) on every request to do this merge -- now we
    // consult a write-through in-memory map that is populated once on first
    // request and updated synchronously after every extras mutation. The
    // populate was kicked off in parallel above, so on warm requests this
    // await is effectively free.
    const needsFolderOverrides = hasPagination || hasGalleryQueryParams || hasFocusQuery;
    const folderOverrides = needsFolderOverrides
      ? await markStage('query_extras_load', () => folderOverridesPromise)
      : null;
    diagnostics.query_extras_image_count = folderOverrides ? folderOverrides.size : 0;
    if (folderOverrides && folderOverrides.size > 0) {
      finalImages = await markStage('query_extras_folder_merge', () =>
        applyFolderOverridesToAssets(finalImages, folderOverrides)
      );
    }
    if ((aspectRatioClass || aspectRatio) && aspectRatioClasses.length === 0) {
      finalImages = finalImages.filter((image) => {
        const entry = image as Record<string, unknown>;
        if (entry.assetType === 'video') {
          if (aspectRatio && typeof entry.aspectRatio === 'string') {
            return entry.aspectRatio === aspectRatio;
          }
          return true;
        }
        if (aspectRatioClass) {
          const dimensions = entry.dimensions as { width?: number; height?: number } | undefined;
          const ratio = dimensions?.width && dimensions?.height
            ? dimensions.width / dimensions.height
            : null;
          const isSquare = ratio !== null && Math.abs(ratio - 1) <= 0.05;
          if (aspectRatioClass === 'square') return Boolean(isSquare);
          if (aspectRatioClass === 'horizontal') return ratio !== null && ratio > 1.05;
          if (aspectRatioClass === 'vertical') return ratio !== null && ratio < 0.95;
          return false;
        }
        if (aspectRatio) {
          return entry.aspectRatio === aspectRatio;
        }
        return true;
      });
    }

    diagnostics.pre_pagination_count = finalImages.length;
    // Build a stable scope key that uniquely identifies the dataset+scope
    // passed into queryGalleryAssets. As long as this key is unchanged
    // between requests, the family/facet/hidden-filter intermediates can be
    // safely reused. The key intentionally excludes per-request filters
    // (search, folder, tag, page, etc.) because those are applied AFTER
    // the memoized stage.
    const cacheStats = getCacheStats();
    const scopeKey = [
      'v2',
      cacheStats.lastFetched,
      getImageFolderOverridesVersion(),
      namespace ?? '__all__',
      mediaFilter ?? '__none__',
      includeFamilyFor || '__none__',
      videoLimit,
      videoAssetsEnabled ? 'v1' : 'v0',
    ].join('|');
    const queryResult = hasPagination || hasGalleryQueryParams || hasFocusQuery
      ? await markStage('gallery_query', () =>
          queryGalleryAssets<GalleryQueryAsset>(
            finalImages,
            {
              search,
              folder,
              tag,
              onlyCanonical,
              onlyWithVariants,
              favorites,
              duplicates,
              comfy,
              embedding,
              aspectRatioClasses,
              dateStart,
              dateEnd,
              hiddenFolders,
              hiddenTags,
            },
            page,
            hasPagination || hasFocusQuery ? pageSize : Math.max(1, finalImages.length),
            focusAssetId,
            scopeKey
          )
        )
      : null;
    const totalBeforePagination = queryResult?.total ?? finalImages.length;
    if (queryResult && (hasPagination || hasGalleryQueryParams)) {
      finalImages = queryResult.images;
    }
    diagnostics.pagination_enabled = hasPagination;
    diagnostics.page = hasPagination && queryResult ? queryResult.page : null;
    diagnostics.page_size = hasPagination && queryResult ? queryResult.pageSize : null;
    diagnostics.total_before_pagination = totalBeforePagination;

    const imageIdsForExtras = finalImages
      .filter((asset) => (asset as { assetType?: string }).assetType !== 'video')
      .map((asset) => String((asset as { id: string }).id))
      .filter(Boolean);
    diagnostics.extras_image_count = includeExtras ? imageIdsForExtras.length : 0;
    // includeExtras requests merge full extras records into the response for
    // the page slice only -- typically ~60 ids, not the full scope. The
    // pre-pagination folder merge above does NOT pull full records anymore,
    // so we always need to MGET here when includeExtras is requested.
    const extrasById = includeExtras && imageIdsForExtras.length > 0
      ? await markStage('extras_load', () => getImageExtrasRecords(imageIdsForExtras))
      : {};

    const withExtrasApplied = includeExtras
      ? await markStage('extras_merge', () => finalImages.map((asset) => {
          const typed = asset as Record<string, unknown> & { id: string; assetType?: string };
          if (typed.assetType === 'video') return asset;
          const extras = extrasById[typed.id];
          if (!extras) return asset;

          const hasExtrasFolder = Object.prototype.hasOwnProperty.call(extras, 'folder');
          const extrasFolder = hasExtrasFolder && typeof extras.folder === 'string' ? extras.folder : undefined;
          const extrasDescription = typeof extras.description === 'string' ? extras.description : undefined;
          const extrasAltText = typeof extras.altText === 'string' ? extras.altText : undefined;
          const extrasSourceUrl = typeof extras.sourceUrl === 'string' ? extras.sourceUrl : undefined;
          const extrasSourceUrlNormalized =
            typeof extras.sourceUrlNormalized === 'string' ? extras.sourceUrlNormalized : undefined;
          const extrasOriginalUrl = typeof extras.originalUrl === 'string' ? extras.originalUrl : undefined;
          const extrasOriginalUrlNormalized =
            typeof extras.originalUrlNormalized === 'string' ? extras.originalUrlNormalized : undefined;

          return {
            ...typed,
            folder: hasExtrasFolder ? extrasFolder : typed.folder,
            description: extrasDescription ?? typed.description,
            sourceUrl: extrasSourceUrl ?? typed.sourceUrl,
            sourceUrlNormalized: extrasSourceUrlNormalized ?? typed.sourceUrlNormalized,
            originalUrl: extrasOriginalUrl ?? typed.originalUrl,
            originalUrlNormalized: extrasOriginalUrlNormalized ?? typed.originalUrlNormalized,
            altTag: extrasAltText ?? typed.altTag,
            altText: extrasAltText,
          };
        }))
      : finalImages;

    // cacheStats is captured earlier in this function (above gallery_query)
    // for the scope key; reuse it here for the response body so we don't pay
    // the (cheap, but still nonzero) cost twice.
    const cache = cacheStats;
    const serializedImages = await markStage('serialize_images', () =>
      withExtrasApplied.map((image) => toListableImage(image as Record<string, unknown>))
    );
    diagnostics.response_image_count = serializedImages.length;
    timings.total = mark(performance.now() - startedAt);
    const responseBody = {
      images: serializedImages,
      cache,
      namespace: namespace ?? null,
      videoMeta,
      timings,
      diagnostics,
      includeVectorMeta,
      includeExtras,
      facets: queryResult?.facets ?? null,
      familySummaryMap: queryResult?.familySummaryMap ?? {},
      duplicateSummary: queryResult?.duplicateSummary ?? null,
      focus: queryResult?.focus ?? null,
      pagination: hasPagination || hasFocusQuery
        ? {
            page: queryResult?.page ?? page,
            pageSize: queryResult?.pageSize ?? pageSize,
            scopeTotal: queryResult?.scopeTotal ?? diagnostics.pre_pagination_count,
            total: totalBeforePagination,
            totalPages: queryResult?.totalPages ?? Math.max(1, Math.ceil(totalBeforePagination / pageSize)),
          }
        : null,
    };
    const payloadBytes = Buffer.byteLength(JSON.stringify(responseBody));
    diagnostics.payload_kb = mark(payloadBytes / 1024);
    const response = NextResponse.json(responseBody);
    response.headers.set(
      'Server-Timing',
      Object.entries(timings)
        .map(([name, duration]) => `${name};dur=${duration}`)
        .join(', ')
    );
    response.headers.set('X-Photarium-Payload-KB', String(diagnostics.payload_kb));
    if (timings.total >= 1000) {
      console.warn('[ImagesAPI] Slow response', {
        totalMs: timings.total,
        cacheLoadMs: timings.cache_load,
        redisBatchMs: timings.redis_batch,
        extrasLoadMs: timings.extras_load,
        serializeMs: timings.serialize_images,
        scopedAssets: diagnostics.scoped_asset_count,
        extrasImages: diagnostics.extras_image_count,
        payloadKb: diagnostics.payload_kb,
      includeVectorMeta,
      forceRefresh,
      namespace: namespace ?? null,
      mediaFilter,
      videoLimit,
      includeFamilyFor,
    });
    }
    return response;
  } catch (error) {
    console.error('Fetch images error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
