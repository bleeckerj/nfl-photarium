import { useCallback, useEffect, useRef, useState } from 'react';

import { setEmbeddingPendingEntry } from '@/utils/embeddingPending';
import type { UploadedImage } from '@/components/image-uploader/types';

export const useUploadActivity = () => {
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [embeddingQueueDepth, setEmbeddingQueueDepth] = useState(0);
  const [activeUploadOps, setActiveUploadOps] = useState(0);
  const embeddingQueueRef = useRef<Array<{ id: string; clip: boolean; color: boolean }>>([]);
  const embeddingWorkerRef = useRef(false);
  const activeUploadOpsRef = useRef(0);

  const updateEmbeddingPending = useCallback((
    id: string,
    status?: 'queued' | 'embedding' | 'error',
    clip?: boolean,
    color?: boolean,
    error?: string
  ) => {
    if (!status || clip === undefined || color === undefined) {
      setEmbeddingPendingEntry(id, undefined);
      return;
    }
    setEmbeddingPendingEntry(id, {
      status,
      clip,
      color,
      error,
      updatedAt: new Date().toISOString(),
    });
  }, []);

  const beginUploadActivity = useCallback(() => {
    activeUploadOpsRef.current += 1;
    setActiveUploadOps(activeUploadOpsRef.current);
    setIsUploading(true);
  }, []);

  const endUploadActivity = useCallback(() => {
    activeUploadOpsRef.current = Math.max(0, activeUploadOpsRef.current - 1);
    setActiveUploadOps(activeUploadOpsRef.current);
    setIsUploading(activeUploadOpsRef.current > 0);
  }, []);

  const processEmbeddingQueue = useCallback(async () => {
    if (embeddingWorkerRef.current) return;
    if (activeUploadOpsRef.current > 0) return;
    embeddingWorkerRef.current = true;

    while (embeddingQueueRef.current.length > 0) {
      if (activeUploadOpsRef.current > 0) {
        break;
      }
      const job = embeddingQueueRef.current.shift();
      setEmbeddingQueueDepth(embeddingQueueRef.current.length);
      if (!job) continue;

      updateEmbeddingPending(job.id, 'embedding', job.clip, job.color);
      setUploadedImages((prev) =>
        prev.map((img) =>
          img.id === job.id
            ? {
                ...img,
                embeddingStatus: 'embedding',
                embeddingError: undefined,
                embeddingRequested: { clip: job.clip, color: job.color },
              }
            : img
        )
      );

      try {
        const response = await fetch(`/api/images/${job.id}/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clip: job.clip, color: job.color }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          const message = typeof data?.error === 'string' ? data.error : 'Embedding failed';
          throw new Error(message);
        }

        updateEmbeddingPending(job.id, undefined);
        setUploadedImages((prev) =>
          prev.map((img) =>
            img.id === job.id
              ? { ...img, embeddingStatus: 'success', embeddingError: undefined }
              : img
          )
        );
      } catch (error) {
        updateEmbeddingPending(
          job.id,
          'error',
          job.clip,
          job.color,
          error instanceof Error ? error.message : 'Embedding failed'
        );
        setUploadedImages((prev) =>
          prev.map((img) =>
            img.id === job.id
              ? {
                  ...img,
                  embeddingStatus: 'error',
                  embeddingError: error instanceof Error ? error.message : 'Embedding failed',
                }
              : img
          )
        );
      }
    }

    embeddingWorkerRef.current = false;
  }, [updateEmbeddingPending]);

  const enqueueEmbedding = useCallback((imageId: string, clip: boolean, color: boolean) => {
    if (!clip && !color) return;
    embeddingQueueRef.current.push({ id: imageId, clip, color });
    setEmbeddingQueueDepth(embeddingQueueRef.current.length);
    updateEmbeddingPending(imageId, 'queued', clip, color);
    setUploadedImages((prev) =>
      prev.map((img) =>
        img.id === imageId
          ? {
              ...img,
              embeddingStatus: 'queued',
              embeddingError: undefined,
              embeddingRequested: { clip, color },
            }
          : img
      )
    );
    void processEmbeddingQueue();
  }, [processEmbeddingQueue, updateEmbeddingPending]);

  useEffect(() => {
    if (activeUploadOps > 0) return;
    if (embeddingQueueRef.current.length === 0) return;
    void processEmbeddingQueue();
  }, [activeUploadOps, processEmbeddingQueue]);

  return {
    uploadedImages,
    setUploadedImages,
    isUploading,
    activeUploadOps,
    embeddingQueueDepth,
    beginUploadActivity,
    endUploadActivity,
    enqueueEmbedding,
  };
};
