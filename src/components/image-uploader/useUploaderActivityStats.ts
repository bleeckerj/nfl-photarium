import { useMemo } from 'react';
import type { ActivityStats } from '@/components/image-uploader/ActivityIndicator';
import type { UploadedImage } from '@/components/image-uploader/types';

export function useUploaderActivityStats({
  uploadedImages,
  activeUploadOps,
  embeddingQueueDepth,
}: {
  uploadedImages: UploadedImage[];
  activeUploadOps: number;
  embeddingQueueDepth: number;
}) {
  const activityStats = useMemo((): ActivityStats => {
    const uploading = uploadedImages.filter((img) => img.status === 'uploading').length;
    const uploaded = uploadedImages.filter((img) => img.status === 'success').length;
    const errors = uploadedImages.filter((img) => img.status === 'error').length;
    const embedding = uploadedImages.filter((img) => img.embeddingStatus === 'embedding').length;
    const embedded = uploadedImages.filter((img) => img.embeddingStatus === 'success').length;
    const embeddingQueued = uploadedImages.filter((img) => img.embeddingStatus === 'queued').length;

    return {
      total: uploadedImages.length,
      uploading,
      uploaded,
      embedding,
      embedded,
      errors,
      embeddingQueue: embeddingQueueDepth + embeddingQueued,
    };
  }, [uploadedImages, embeddingQueueDepth]);

  const isActivityActive = useMemo(
    () => activeUploadOps > 0 || activityStats.uploading > 0 || activityStats.embedding > 0 || embeddingQueueDepth > 0,
    [activeUploadOps, activityStats.uploading, activityStats.embedding, embeddingQueueDepth]
  );

  return { activityStats, isActivityActive };
}
