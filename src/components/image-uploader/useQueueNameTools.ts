'use client';

import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import { appendTextToFilename, removeFilenameExtension, sanitizeFilename } from '@/utils/filename';
import { inferAssetTypeFromUrl } from '@/utils/mediaAssetType';
import { inferAssetTypeFromFile, resolveTagInput } from '@/components/image-uploader/fileHelpers';
import type { UploaderQueueItem } from '@/features/page-import/types';

type UseQueueNameToolsOptions = {
  queuedFiles: UploaderQueueItem[];
  tags: string;
  resolveFolder: () => string;
  updateQueuedFile: (id: string, updates: Partial<UploaderQueueItem>) => void;
  setQueuedFiles: Dispatch<SetStateAction<UploaderQueueItem[]>>;
};

const mapFilenames = (
  setQueuedFiles: Dispatch<SetStateAction<UploaderQueueItem[]>>,
  transform: (filename: string) => string
) => {
  setQueuedFiles((prev) => prev.map((item) => ({ ...item, filename: transform(item.filename) })));
};

/**
 * Bulk filename editing for the upload queue: the AI shortname pass plus the
 * mechanical rename, strip-extension, sanitize, and append operations.
 */
export function useQueueNameTools({
  queuedFiles,
  tags,
  resolveFolder,
  updateQueuedFile,
  setQueuedFiles,
}: UseQueueNameToolsOptions) {
  const [aiRefiningNames, setAiRefiningNames] = useState(false);
  const [queueRenameValue, setQueueRenameValue] = useState('');
  const [queueAppendValue, setQueueAppendValue] = useState('');

  const refineOneName = useCallback(
    async (item: UploaderQueueItem, fallbackFolder: string) => {
      const formData = new FormData();
      if (item.file) {
        formData.append('file', item.file);
      } else if (item.remoteUrl) {
        formData.append('remoteUrl', item.remoteUrl);
      } else {
        updateQueuedFile(item.id, { processingNote: 'AI naming skipped: no image source' });
        return;
      }

      formData.append('filename', item.filename);
      const folderHint = item.folder !== undefined ? item.folder : fallbackFolder;
      if (folderHint) formData.append('folder', folderHint);
      const tagHint = resolveTagInput(tags, item.tags);
      if (tagHint) formData.append('tags', tagHint);

      let response: Response | null = null;
      let payload: { displayName?: string; error?: string } = {};
      // One retry: the suggest endpoint occasionally drops a connection mid-flight.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          response = await fetch('/api/display-name/suggest', { method: 'POST', body: formData });
          payload = (await response.json().catch(() => ({}))) as {
            displayName?: string;
            error?: string;
          };
          break;
        } catch (error) {
          const abortedLike =
            error instanceof Error &&
            (error.name === 'AbortError' ||
              error.message.includes('aborted') ||
              error.message.includes('ECONNRESET'));
          if (attempt === 0 && abortedLike) {
            await new Promise((resolve) => setTimeout(resolve, 200));
            continue;
          }
          throw error;
        }
      }

      if (!response || !response.ok || !payload.displayName) {
        // Name the stage: upstream provider errors are passed through verbatim and
        // otherwise read as though the upload had failed.
        updateQueuedFile(item.id, {
          processingNote: `AI naming failed: ${payload.error || 'unknown error'}`,
          processingNoteTone: 'error',
        });
        return;
      }

      updateQueuedFile(item.id, {
        filename: payload.displayName,
        processingNote: `AI shortname: ${payload.displayName}`,
        processingNoteTone: 'info',
      });
    },
    [tags, updateQueuedFile]
  );

  const handleAiRefineQueuedNames = useCallback(
    async (scope: 'selected' | 'all-images') => {
      const targetItems = queuedFiles.filter((item) => {
        if (scope === 'selected' && item.selected === false) return false;
        const effectiveAssetType =
          item.assetType ??
          (item.file ? inferAssetTypeFromFile(item.file) : inferAssetTypeFromUrl(item.remoteUrl));
        return effectiveAssetType === 'image';
      });
      if (targetItems.length === 0) return;

      setAiRefiningNames(true);
      try {
        const fallbackFolder = resolveFolder();
        for (const item of targetItems) {
          try {
            await refineOneName(item, fallbackFolder);
          } catch (error) {
            const message =
              error instanceof Error && error.message.trim().length > 0
                ? error.message
                : 'Network request failed';
            updateQueuedFile(item.id, {
              processingNote: `AI naming failed: ${message}`,
              processingNoteTone: 'error',
            });
            console.error('Failed to refine queued name for item', { itemId: item.id, error });
          }
        }
      } catch (error) {
        console.error('Failed to refine queued names with AI', error);
      } finally {
        setAiRefiningNames(false);
      }
    },
    [queuedFiles, refineOneName, resolveFolder, updateQueuedFile]
  );

  const applyQueueNameToAll = useCallback(() => {
    const nextName = queueRenameValue.trim();
    if (!nextName) return;
    mapFilenames(setQueuedFiles, () => nextName);
  }, [queueRenameValue, setQueuedFiles]);

  const removeQueueExtensions = useCallback(() => {
    mapFilenames(setQueuedFiles, removeFilenameExtension);
  }, [setQueuedFiles]);

  const sanitizeQueueNames = useCallback(() => {
    mapFilenames(setQueuedFiles, sanitizeFilename);
  }, [setQueuedFiles]);

  const appendTextToQueueNames = useCallback(() => {
    const text = queueAppendValue.trim();
    if (!text) return;
    mapFilenames(setQueuedFiles, (filename) => appendTextToFilename(filename, text));
  }, [queueAppendValue, setQueuedFiles]);

  return {
    aiRefiningNames,
    queueRenameValue,
    setQueueRenameValue,
    queueAppendValue,
    setQueueAppendValue,
    handleAiRefineQueuedNames,
    applyQueueNameToAll,
    removeQueueExtensions,
    sanitizeQueueNames,
    appendTextToQueueNames,
  };
}
