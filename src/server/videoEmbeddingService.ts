import { generateClipEmbedding } from '@/server/embeddingService';
import { ensureVectorIndex, isVectorSearchAvailable, storeImageVectors } from '@/server/vectorSearch';
import { type VideoAssetRecord, updateVideoAssetRecord } from '@/server/videoCatalogStorage';

export type VideoEmbeddingStatus = {
  enabled: boolean;
  queued: boolean;
  reason?: 'disabled' | 'redis-unavailable' | 'missing-thumbnail' | 'already-exists' | 'unknown';
};

const isTruthyDisabled = (value: string) => {
  const lowered = value.trim().toLowerCase();
  return lowered === '0' || lowered === 'false' || lowered === 'no' || lowered === 'off';
};

const isAutoEmbedOnUploadEnabled = (): boolean => {
  const raw = process.env.AUTO_EMBED_ON_UPLOAD;
  if (raw === undefined) return true;
  return !isTruthyDisabled(raw);
};

const getEmbeddingImageUrl = (record: VideoAssetRecord): string | null => (
  record.thumbnailUrl || record.previewUrl || null
);

async function generateAndStoreVideoClipEmbedding(record: VideoAssetRecord): Promise<void> {
  const imageUrl = getEmbeddingImageUrl(record);
  if (!imageUrl) return;

  await ensureVectorIndex();
  const embedding = await generateClipEmbedding(imageUrl, {
    source: 'video',
    component: 'videoEmbeddingService',
    trigger: 'video-upload',
    query: record.filename,
  });
  if (!embedding) return;

  await storeImageVectors({
    imageId: record.id,
    filename: record.filename,
    folder: record.folder,
    clipEmbedding: embedding,
    aspectRatio: record.aspectRatio,
    width: record.width,
    height: record.height,
  });
  await updateVideoAssetRecord(record.id, { hasClipEmbedding: true });
}

export async function queueAutoEmbeddingsForVideo(record: VideoAssetRecord): Promise<VideoEmbeddingStatus> {
  if (record.hasClipEmbedding) {
    return { enabled: true, queued: false, reason: 'already-exists' };
  }
  if (!isAutoEmbedOnUploadEnabled()) {
    return { enabled: false, queued: false, reason: 'disabled' };
  }

  const imageUrl = getEmbeddingImageUrl(record);
  if (!imageUrl) {
    return { enabled: true, queued: false, reason: 'missing-thumbnail' };
  }

  try {
    const available = await isVectorSearchAvailable();
    if (!available) {
      return { enabled: true, queued: false, reason: 'redis-unavailable' };
    }

    void generateAndStoreVideoClipEmbedding(record).catch((error) => {
      console.warn('[videoEmbeddingService] Failed to generate video CLIP embedding', {
        videoId: record.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return { enabled: true, queued: true };
  } catch {
    return { enabled: true, queued: false, reason: 'unknown' };
  }
}

