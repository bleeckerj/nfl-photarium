'use client';

import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
import { unselectAttemptedQueuedItems } from '@/features/page-import/utils/queueSelection';
import type { UploaderQueueItem } from '@/features/page-import/types';

type UseManualUploadOptions = {
  queuedFiles: UploaderQueueItem[];
  uploadNamespace: string | null;
  markNamespaceUploadFailures: (items: UploaderQueueItem[]) => void;
  uploadFiles: (items: UploaderQueueItem[]) => Promise<void>;
  uploadRemoteFiles: (items: UploaderQueueItem[]) => Promise<void>;
  setQueuedFiles: Dispatch<SetStateAction<UploaderQueueItem[]>>;
};

/**
 * The Upload button. Splits the selection into local files and remote URLs,
 * sends each through its own path, then unselects everything it attempted so a
 * second click does not re-upload the same items. The in-flight ref guards
 * against a double click starting two runs.
 */
export function useManualUpload({
  queuedFiles,
  uploadNamespace,
  markNamespaceUploadFailures,
  uploadFiles,
  uploadRemoteFiles,
  setQueuedFiles,
}: UseManualUploadOptions) {
  const inFlightRef = useRef(false);

  return useCallback(async () => {
    if (inFlightRef.current) return;

    const selectedItems = queuedFiles.filter((item) => item.selected !== false);
    if (selectedItems.length === 0) return;
    if (!uploadNamespace) {
      markNamespaceUploadFailures(selectedItems);
      return;
    }

    inFlightRef.current = true;
    try {
      const localItems = selectedItems.filter((item) => Boolean(item.file));
      const remoteItems = selectedItems.filter((item) => Boolean(item.remoteUrl) && !item.file);

      if (localItems.length > 0) {
        await uploadFiles(
          localItems.map((item) => ({
            assetType: item.assetType,
            file: item.file,
            filename: item.filename,
            id: item.id,
            originalUrl: item.originalUrl,
            sourceUrl: item.sourceUrl,
            sourcePath: item.sourcePath,
            posterUrl: item.posterUrl,
            isBlobSource: item.isBlobSource,
            folder: item.folder,
            tags: item.tags,
            description: item.description,
            selected: item.selected,
          }))
        );
      }

      if (remoteItems.length > 0) {
        await uploadRemoteFiles(remoteItems);
      }

      const attemptedIds = new Set(selectedItems.map((item) => item.id));
      setQueuedFiles((prev) => unselectAttemptedQueuedItems(prev, attemptedIds));
    } finally {
      inFlightRef.current = false;
    }
  }, [
    markNamespaceUploadFailures,
    queuedFiles,
    setQueuedFiles,
    uploadFiles,
    uploadNamespace,
    uploadRemoteFiles,
  ]);
}
