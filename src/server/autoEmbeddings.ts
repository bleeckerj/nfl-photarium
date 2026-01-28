import { ensureVectorIndex, isVectorSearchAvailable, storeImageVectors } from '@/server/vectorSearch';
import { generateClipEmbedding } from '@/server/embeddingService';
import { extractColorsFromUrl } from '@/server/colorExtraction';
import { upsertCachedImage, type CachedCloudflareImage } from '@/server/cloudflareImageCache';

export type AutoEmbeddingsStatus = {
  enabled: boolean;
  queued: boolean;
  reason?: 'disabled' | 'redis-unavailable' | 'missing-variants' | 'unknown';
};

const isTruthyDisabled = (value: string) => {
  const lowered = value.trim().toLowerCase();
  return lowered === '0' || lowered === 'false' || lowered === 'no' || lowered === 'off';
};

export const isAutoEmbedOnUploadEnabled = (): boolean => {
  const raw = process.env.AUTO_EMBED_ON_UPLOAD;
  if (raw === undefined) return true;
  return !isTruthyDisabled(raw);
};

const pickEmbeddingUrl = (image: Pick<CachedCloudflareImage, 'variants'>): string | null => {
  const variants = image.variants ?? [];
  if (!variants.length) return null;
  const variant = variants.find((v) => v.includes('w=300')) || variants[0];
  const parts = variant.split('?');
  const base = parts[0];
  const params = new URLSearchParams(parts[1] || '');
  params.set('format', 'webp');
  return `${base}?${params.toString()}`;
};

async function generateAndStoreEmbeddings(image: CachedCloudflareImage): Promise<void> {
  const url = pickEmbeddingUrl(image);
  if (!url) return;

  await ensureVectorIndex();

  const needsClip = !image.hasClipEmbedding;
  const needsColor = !image.hasColorEmbedding;
  if (!needsClip && !needsColor) return;

  const [clipEmbedding, colorInfo] = await Promise.all([
    needsClip ? generateClipEmbedding(url) : Promise.resolve(null),
    needsColor ? extractColorsFromUrl(url) : Promise.resolve(null),
  ]);

  if (!clipEmbedding && !colorInfo) return;

  await storeImageVectors({
    imageId: image.id,
    filename: image.filename,
    folder: image.folder,
    clipEmbedding: clipEmbedding ?? undefined,
    colorHistogram: colorInfo?.histogram,
    dominantColors: colorInfo?.dominantColors,
    averageColor: colorInfo?.averageColor,
  });

  upsertCachedImage({
    ...image,
    hasClipEmbedding: clipEmbedding ? true : image.hasClipEmbedding,
    hasColorEmbedding: colorInfo ? true : image.hasColorEmbedding,
    dominantColors: colorInfo?.dominantColors ?? image.dominantColors,
    averageColor: colorInfo?.averageColor ?? image.averageColor,
  });
}

/**
 * Best-effort: queues embedding generation and never throws.
 * Designed to be safe to call during uploads.
 */
export async function queueAutoEmbeddingsForImage(
  image: CachedCloudflareImage
): Promise<AutoEmbeddingsStatus> {
  if (!isAutoEmbedOnUploadEnabled()) {
    return { enabled: false, queued: false, reason: 'disabled' };
  }

  if (!image.variants?.length) {
    return { enabled: true, queued: false, reason: 'missing-variants' };
  }

  try {
    const available = await isVectorSearchAvailable();
    if (!available) {
      return { enabled: true, queued: false, reason: 'redis-unavailable' };
    }

    // Fire-and-forget; do not block upload response.
    void generateAndStoreEmbeddings(image).catch((error) => {
      console.warn('[autoEmbeddings] Failed to generate embeddings', {
        imageId: image.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    return { enabled: true, queued: true };
  } catch {
    return { enabled: true, queued: false, reason: 'unknown' };
  }
}
