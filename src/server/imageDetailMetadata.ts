import type { CachedCloudflareImage } from '@/server/cloudflareImageCache';
import {
  batchGetAspectMetadata,
  batchGetColorMetadata,
  isVectorSearchAvailable,
} from '@/server/vectorSearch';

export async function enrichImageWithVectorMetadata(
  image: CachedCloudflareImage,
): Promise<CachedCloudflareImage> {
  const redisAvailable = await isVectorSearchAvailable();
  if (!redisAvailable) {
    return image;
  }

  const [colorMetadata, aspectMetadata] = await Promise.all([
    batchGetColorMetadata([image.id]),
    batchGetAspectMetadata([image.id]),
  ]);

  const color = colorMetadata.get(image.id);
  const aspect = aspectMetadata.get(image.id);
  if (!color && !aspect) {
    return image;
  }

  return {
    ...image,
    hasClipEmbedding: color?.hasClipEmbedding ?? image.hasClipEmbedding,
    hasColorEmbedding: color?.hasColorEmbedding ?? image.hasColorEmbedding,
    dominantColors: color?.dominantColors ?? image.dominantColors,
    averageColor: color?.averageColor ?? image.averageColor,
    aspectRatio: aspect?.aspectRatio ?? image.aspectRatio,
    dimensions: aspect?.width && aspect?.height
      ? { width: aspect.width, height: aspect.height }
      : image.dimensions,
  };
}
