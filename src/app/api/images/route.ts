import { NextRequest, NextResponse } from 'next/server';
import { getCachedImages, getCacheStats } from '@/server/cloudflareImageCache';
import { batchGetAspectMetadata, batchGetColorMetadata, isVectorSearchAvailable } from '@/server/vectorSearch';
import { listVideoAssetRecordsWithSync } from '@/server/videoCatalogStorage';

type ListableImage = {
  id: string;
  assetType?: 'image' | 'video';
  filename: string;
  displayName?: string;
  uploaded: string;
  variants: string[];
  size?: number;
  folder?: string;
  tags?: string[];
  aspectRatio?: string;
  dimensions?: { width: number; height: number };
  altTag?: string;
  parentId?: string;
  linkedAssetId?: string;
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
  hasClipEmbedding?: boolean;
  hasColorEmbedding?: boolean;
  dominantColors?: string[];
  averageColor?: string;
};

function toListableImage(image: Record<string, unknown>): ListableImage {
  const rawDimensions = image.dimensions as { width?: unknown; height?: unknown } | undefined;
  const width = typeof rawDimensions?.width === 'number' ? rawDimensions.width : undefined;
  const height = typeof rawDimensions?.height === 'number' ? rawDimensions.height : undefined;
  const dimensions = width && height ? { width, height } : undefined;

  // Intentionally omit heavy fields like EXIF from the gallery list payload.
  return {
    id: String(image.id ?? ''),
    assetType: image.assetType as 'image' | 'video' | undefined,
    filename: typeof image.filename === 'string' ? image.filename : '',
    displayName: typeof image.displayName === 'string' ? image.displayName : undefined,
    uploaded: typeof image.uploaded === 'string' ? image.uploaded : '',
    variants: Array.isArray(image.variants) ? (image.variants as string[]) : [],
    size: typeof image.size === 'number' ? image.size : undefined,
    folder: typeof image.folder === 'string' ? image.folder : undefined,
    tags: Array.isArray(image.tags) ? (image.tags as string[]) : undefined,
    aspectRatio: typeof image.aspectRatio === 'string' ? image.aspectRatio : undefined,
    dimensions,
    altTag: typeof image.altTag === 'string' ? image.altTag : undefined,
    parentId: typeof image.parentId === 'string' ? image.parentId : undefined,
    linkedAssetId: typeof image.linkedAssetId === 'string' ? image.linkedAssetId : undefined,
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

  try {
    const forceRefresh = request.nextUrl.searchParams.get('refresh') === '1';
    const includeVectorMeta = request.nextUrl.searchParams.get('includeVectorMeta') === '1';
    const aspectRatioClass = request.nextUrl.searchParams.get('aspectRatioClass')?.trim();
    const aspectRatio = request.nextUrl.searchParams.get('aspectRatio')?.trim();
    const namespaceParam = request.nextUrl.searchParams.get('namespace');
    const videoLimitParam = request.nextUrl.searchParams.get('videoLimit');
    const defaultNamespace = process.env.IMAGE_NAMESPACE || process.env.NEXT_PUBLIC_IMAGE_NAMESPACE || '';
    const namespace =
      namespaceParam === '__none__'
        ? ''
        : namespaceParam === '__all__'
          ? null
          : namespaceParam !== null
            ? namespaceParam.trim()
            : defaultNamespace;
    const cacheStart = performance.now();
    const images = await getCachedImages(forceRefresh);
    timings.cache_load = mark(performance.now() - cacheStart);
    const filtered = namespace === null
      ? images
      : namespace === ''
        ? images.filter((image) => !image.namespace)
        : images.filter((image) => image.namespace === namespace);

    const videoAssetsEnabled = process.env.ENABLE_VIDEO_ASSETS === '1';
    const configuredVideoLimit = Number(process.env.VIDEO_ASSET_LIST_LIMIT ?? 300);
    const parsedVideoLimit = videoLimitParam ? Number(videoLimitParam) : configuredVideoLimit;
    const videoLimit = Number.isFinite(parsedVideoLimit) && parsedVideoLimit > 0
      ? Math.floor(parsedVideoLimit)
      : 300;
    const allVideos = videoAssetsEnabled ? await listVideoAssetRecordsWithSync() : [];
    const scopedVideos = allVideos.filter((video) => {
      if (namespace === null) return true;
      if (namespace === '') return !video.namespace;
      return video.namespace === namespace;
    });
    const limitedVideos = scopedVideos.slice(0, videoLimit);
    const mappedVideos = limitedVideos.map((video) => ({
      id: video.id,
      assetType: 'video' as const,
      filename: video.filename,
      displayName: video.filename,
      uploaded: video.uploaded,
      variants: [video.thumbnailUrl || video.playbackUrl || video.hlsUrl || ''].filter(Boolean),
      folder: video.folder,
      tags: video.tags,
      description: video.description,
      originalUrl: video.originalUrl,
      sourceUrl: video.sourceUrl,
      namespace: video.namespace,
      videoStatus: video.videoStatus,
      videoDurationSeconds: video.durationSeconds,
      videoPlaybackUrl: video.playbackUrl,
      videoHlsUrl: video.hlsUrl,
      videoThumbnailUrl: video.thumbnailUrl,
      videoPreviewUrl: video.previewUrl,
      hasClipEmbedding: video.hasClipEmbedding,
      dimensions: video.width && video.height
        ? { width: video.width, height: video.height }
        : undefined,
      aspectRatio: video.aspectRatio,
    }));
    const videoMeta = {
      enabled: videoAssetsEnabled,
      limit: videoLimit,
      returned: limitedVideos.length,
      totalScoped: scopedVideos.length,
      truncated: scopedVideos.length > limitedVideos.length,
    };
    
    // Optional: merge embedding status from Redis.
    // Keep this off by default so gallery can render immediately and enrich asynchronously.
    let imagesWithEmbeddings = filtered;
    if (includeVectorMeta) {
      try {
        const redisCheckStart = performance.now();
        const redisAvailable = await isVectorSearchAvailable();
        timings.redis_check = mark(performance.now() - redisCheckStart);

        if (redisAvailable && filtered.length > 0) {
          const redisBatchStart = performance.now();
          const imageIds = filtered.map(img => img.id);
          const colorMetadata = await batchGetColorMetadata(imageIds);
          const aspectMetadata = await batchGetAspectMetadata(imageIds);
          timings.redis_batch = mark(performance.now() - redisBatchStart);
          
          imagesWithEmbeddings = filtered.map(img => {
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
    
    let finalImages = [...imagesWithEmbeddings, ...mappedVideos];
    if (aspectRatioClass || aspectRatio) {
      finalImages = finalImages.filter((image) => {
        if (image.assetType === 'video') {
          if (aspectRatio && image.aspectRatio) {
            return image.aspectRatio === aspectRatio;
          }
          return true;
        }
        if (aspectRatioClass) {
          const ratio = image.dimensions
            ? image.dimensions.width / image.dimensions.height
            : null;
          const isSquare = ratio !== null && Math.abs(ratio - 1) <= 0.05;
          if (aspectRatioClass === 'square') return Boolean(isSquare);
          if (aspectRatioClass === 'horizontal') return ratio !== null && ratio > 1.05;
          if (aspectRatioClass === 'vertical') return ratio !== null && ratio < 0.95;
          return false;
        }
        if (aspectRatio) {
          return image.aspectRatio === aspectRatio;
        }
        return true;
      });
    }

    const cache = getCacheStats();
    timings.total = mark(performance.now() - startedAt);
    const response = NextResponse.json({
      images: finalImages.map((image) => toListableImage(image as Record<string, unknown>)),
      cache,
      namespace: namespace ?? null,
      videoMeta,
      timings,
      includeVectorMeta,
    });
    response.headers.set(
      'Server-Timing',
      Object.entries(timings)
        .map(([name, duration]) => `${name};dur=${duration}`)
        .join(', ')
    );
    return response;
  } catch (error) {
    console.error('Fetch images error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
