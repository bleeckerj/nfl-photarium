'use client';

import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { inferAssetTypeFromUrl } from '@/utils/mediaAssetType';
import { base64ToFile, inferAssetTypeFromFile } from '@/components/image-uploader/fileHelpers';
import type { UploaderQueueItem } from '@/features/page-import/types';

type UseQueuePreviewFallbackOptions = {
  setQueuedFiles: Dispatch<SetStateAction<UploaderQueueItem[]>>;
};

/**
 * Tracks queue items whose preview image failed to load, and tries to recover
 * remote ones through the import proxy — a remote host that blocks hotlinking
 * still yields a usable preview when fetched server-side.
 */
export function useQueuePreviewFallback({ setQueuedFiles }: UseQueuePreviewFallbackOptions) {
  const [previewFailures, setPreviewFailures] = useState<Record<string, boolean>>({});
  const attemptedRef = useRef<Set<string>>(new Set());

  const markFailed = useCallback((id: string) => {
    setPreviewFailures((prev) => ({ ...prev, [id]: true }));
  }, []);

  const clearFailure = useCallback((id: string) => {
    setPreviewFailures((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const handlePreviewLoadError = useCallback(
    async (item: UploaderQueueItem) => {
      const effectiveAssetType =
        item.assetType ??
        (item.file ? inferAssetTypeFromFile(item.file) : inferAssetTypeFromUrl(item.remoteUrl));

      // Videos, local files, and items without a remote URL can't be recovered
      // via the import proxy. Neither can an item we already tried once.
      if (
        effectiveAssetType === 'video' ||
        item.file ||
        !item.remoteUrl ||
        attemptedRef.current.has(item.id)
      ) {
        markFailed(item.id);
        return;
      }
      attemptedRef.current.add(item.id);

      try {
        const response = await fetch('/api/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: item.remoteUrl }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || 'Preview proxy fetch failed');
        if (!data?.data || !data?.type || !data?.name) {
          throw new Error('Invalid preview proxy response');
        }

        const previewFile = base64ToFile(String(data.data), String(data.name), String(data.type));
        const previewBlobUrl = URL.createObjectURL(previewFile);

        setQueuedFiles((prev) =>
          prev.map((queued) => {
            if (queued.id !== item.id) return queued;
            if (queued.previewUrl && queued.previewUrl.startsWith('blob:')) {
              URL.revokeObjectURL(queued.previewUrl);
            }
            return {
              ...queued,
              previewUrl: previewBlobUrl,
              sizeBytes: queued.sizeBytes ?? previewFile.size,
              contentType: queued.contentType ?? previewFile.type,
            };
          })
        );
        clearFailure(item.id);
      } catch (error) {
        console.warn('[uploader] Preview fallback failed', {
          id: item.id,
          remoteUrl: item.remoteUrl,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        markFailed(item.id);
      }
    },
    [clearFailure, markFailed, setQueuedFiles]
  );

  return { previewFailures, setPreviewFailures, handlePreviewLoadError };
}
