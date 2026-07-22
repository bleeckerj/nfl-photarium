import type { ImageAspectRatioMetadata, ImageColorMetadata } from '@/server/vectorSearch';

export type GalleryOptionalMetadataResult = {
  colorMetadata: Map<string, ImageColorMetadata>;
  aspectMetadata: Map<string, ImageAspectRatioMetadata>;
  redisAvailable: boolean;
  timings: Record<string, number>;
  diagnostics: Record<string, number | boolean>;
};

const mark = (value: number): number => Number(value.toFixed(1));

const emptyResult = (): GalleryOptionalMetadataResult => ({
  colorMetadata: new Map(),
  aspectMetadata: new Map(),
  redisAvailable: false,
  timings: {},
  diagnostics: {},
});

/**
 * Load Redis-backed gallery metadata only for requests that explicitly need it.
 * The dynamic import keeps sharp/libvips out of the ordinary catalog-list path.
 */
export async function loadGalleryOptionalMetadata(options: {
  imageIds: string[];
  needsColorMetadata: boolean;
  needsAspectMetadata: boolean;
}): Promise<GalleryOptionalMetadataResult> {
  if (!options.needsColorMetadata && !options.needsAspectMetadata) {
    return emptyResult();
  }

  try {
    const {
      batchGetAspectMetadata,
      batchGetColorMetadata,
      isVectorSearchAvailable,
    } = await import('@/server/vectorSearch');
    const redisCheckStart = performance.now();
    const redisAvailable = await isVectorSearchAvailable();
    const timings: Record<string, number> = {
      redis_check: mark(performance.now() - redisCheckStart),
    };

    if (!redisAvailable || options.imageIds.length === 0) {
      return { ...emptyResult(), redisAvailable, timings };
    }

    const redisBatchStart = performance.now();
    const [colorMetadata, aspectMetadata] = await Promise.all([
      options.needsColorMetadata
        ? batchGetColorMetadata(options.imageIds)
        : Promise.resolve(new Map<string, ImageColorMetadata>()),
      options.needsAspectMetadata
        ? batchGetAspectMetadata(options.imageIds)
        : Promise.resolve(new Map<string, ImageAspectRatioMetadata>()),
    ]);

    return {
      colorMetadata,
      aspectMetadata,
      redisAvailable,
      timings: {
        ...timings,
        redis_batch: mark(performance.now() - redisBatchStart),
      },
      diagnostics: {
        redis_image_count: options.imageIds.length,
        redis_color_lookup: options.needsColorMetadata,
        redis_aspect_lookup: options.needsAspectMetadata,
      },
    };
  } catch (error) {
    console.warn('[ImagesAPI] Redis unavailable for embedding status:', error);
    return emptyResult();
  }
}
