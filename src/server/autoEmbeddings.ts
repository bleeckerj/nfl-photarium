import { ensureVectorIndex, isVectorSearchAvailable, storeImageVectors } from '@/server/vectorSearch';
import { generateClipEmbedding } from '@/server/embeddingService';
import { extractColorsFromUrl } from '@/server/colorExtraction';
import { upsertCachedImage, type CachedCloudflareImage } from '@/server/cloudflareImageCache';

export type AutoEmbeddingsStatus = {
  enabled: boolean;
  queued: boolean;
  reason?:
    | 'disabled'
    | 'redis-unavailable'
    | 'missing-variants'
    | 'local-provider-disabled'
    /** SVG: indexed via its rasterized companion, which is the family head. */
    | 'deferred-to-raster-companion'
    | 'unknown';
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

const isLocalEmbeddingProvider = () =>
  (process.env.EMBEDDING_PROVIDER || 'huggingface').trim().toLowerCase() === 'local';

const isAutoEmbedAllowedForLocalProvider = () => {
  const raw = process.env.AUTO_EMBED_ON_UPLOAD_LOCAL_PROVIDER;
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

  await upsertCachedImage({
    ...image,
    hasClipEmbedding: clipEmbedding ? true : image.hasClipEmbedding,
    hasColorEmbedding: colorInfo ? true : image.hasColorEmbedding,
    dominantColors: colorInfo?.dominantColors ?? image.dominantColors,
    averageColor: colorInfo?.averageColor ?? image.averageColor,
  });
}

const MAX_AUTO_EMBED_QUEUE = Math.max(
  1,
  Number(process.env.AUTO_EMBED_QUEUE_MAX ?? 200)
);
const AUTO_EMBED_CONCURRENCY = Math.max(
  1,
  Number(process.env.AUTO_EMBED_CONCURRENCY ?? 1)
);

const pendingQueue: CachedCloudflareImage[] = [];
let activeWorkers = 0;

const drainAutoEmbedQueue = () => {
  while (activeWorkers < AUTO_EMBED_CONCURRENCY && pendingQueue.length > 0) {
    const next = pendingQueue.shift();
    if (!next) break;
    activeWorkers += 1;
    void generateAndStoreEmbeddings(next)
      .catch((error) => {
        console.warn('[autoEmbeddings] Failed to generate embeddings', {
          imageId: next.id,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        activeWorkers = Math.max(0, activeWorkers - 1);
        drainAutoEmbedQueue();
      });
  }
};

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

  if (isLocalEmbeddingProvider() && !isAutoEmbedAllowedForLocalProvider()) {
    return { enabled: false, queued: false, reason: 'local-provider-disabled' };
  }

  if (!image.variants?.length) {
    return { enabled: true, queued: false, reason: 'missing-variants' };
  }

  try {
    const available = await isVectorSearchAvailable();
    if (!available) {
      return { enabled: true, queued: false, reason: 'redis-unavailable' };
    }

    if (pendingQueue.length >= MAX_AUTO_EMBED_QUEUE) {
      console.warn('[autoEmbeddings] Queue at capacity; dropping auto-embed request', {
        imageId: image.id,
        queueSize: pendingQueue.length,
        maxQueue: MAX_AUTO_EMBED_QUEUE,
      });
      return { enabled: true, queued: false, reason: 'unknown' };
    }

    pendingQueue.push(image);
    drainAutoEmbedQueue();

    return { enabled: true, queued: true };
  } catch {
    return { enabled: true, queued: false, reason: 'unknown' };
  }
}
