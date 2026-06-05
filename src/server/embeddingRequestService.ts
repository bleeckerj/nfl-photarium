import type { CachedCloudflareImage } from '@/server/cloudflareImageCache';
import type { ImageVectorData } from '@/server/vectorSearch';

export interface EmbeddingRequestOptions {
  generateClip: boolean;
  generateColor: boolean;
  force: boolean;
}

export interface EmbeddingReadiness {
  hasStoredClip: boolean;
  hasStoredColor: boolean;
  hasColorMetadata: boolean;
  hasClipEmbedding: boolean;
  hasColorEmbedding: boolean;
  dominantColors?: string[];
  averageColor?: string;
  needsClip: boolean;
  needsColor: boolean;
}

export const pickEmbeddingImageUrl = (
  image: Pick<CachedCloudflareImage, 'variants'>
): string | null => {
  const variants = image.variants ?? [];
  if (variants.length === 0) return null;

  const variant = variants.find((item) => item.includes('w=300')) || variants[0];
  const [base, query = ''] = variant.split('?');
  const params = new URLSearchParams(query);
  params.set('format', 'webp');
  return `${base}?${params.toString()}`;
};

export const assessEmbeddingReadiness = (
  image: CachedCloudflareImage,
  existingVectors: ImageVectorData | null,
  options: EmbeddingRequestOptions
): EmbeddingReadiness => {
  const hasStoredClip = Boolean(existingVectors?.clipEmbedding?.length);
  const hasStoredColor = Boolean(existingVectors?.colorHistogram?.length);
  const dominantColors = existingVectors?.dominantColors ?? image.dominantColors;
  const averageColor = existingVectors?.averageColor ?? image.averageColor;
  const hasColorMetadata = Boolean(dominantColors?.length && averageColor);

  return {
    hasStoredClip,
    hasStoredColor,
    hasColorMetadata,
    hasClipEmbedding: hasStoredClip || Boolean(image.hasClipEmbedding),
    hasColorEmbedding: hasStoredColor || Boolean(image.hasColorEmbedding),
    dominantColors,
    averageColor,
    needsClip: options.generateClip && (options.force || !hasStoredClip),
    needsColor: options.generateColor && (
      options.force ||
      !hasStoredColor ||
      !hasColorMetadata
    ),
  };
};

export const needsCachedEmbeddingUpdate = (
  image: CachedCloudflareImage,
  readiness: Pick<
    EmbeddingReadiness,
    'hasClipEmbedding' | 'hasColorEmbedding' | 'dominantColors' | 'averageColor'
  >
): boolean =>
  Boolean(readiness.hasClipEmbedding) !== Boolean(image.hasClipEmbedding) ||
  Boolean(readiness.hasColorEmbedding) !== Boolean(image.hasColorEmbedding) ||
  (
    readiness.dominantColors !== undefined &&
    readiness.dominantColors !== image.dominantColors
  ) ||
  (
    readiness.averageColor !== undefined &&
    readiness.averageColor !== image.averageColor
  );

export const applyEmbeddingReadinessToImage = (
  image: CachedCloudflareImage,
  readiness: Pick<
    EmbeddingReadiness,
    'hasClipEmbedding' | 'hasColorEmbedding' | 'dominantColors' | 'averageColor'
  >
): CachedCloudflareImage => ({
  ...image,
  hasClipEmbedding: readiness.hasClipEmbedding,
  hasColorEmbedding: readiness.hasColorEmbedding,
  dominantColors: readiness.dominantColors ?? image.dominantColors,
  averageColor: readiness.averageColor ?? image.averageColor,
});
