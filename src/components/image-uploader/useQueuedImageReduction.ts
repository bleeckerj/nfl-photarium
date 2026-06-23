'use client';

import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import {
  MAX_UPLOAD_IMAGE_BYTES,
  isImageFile,
  reduceImageFileToLimit,
} from '@/components/image-uploader/fileHelpers';
import {
  buildQueueReductionUpdate,
  importRemoteQueueImage,
} from '@/components/image-uploader/queueReduction';
import type { UploaderQueueItem } from '@/features/page-import/types';
import { inferAssetTypeFromFile } from '@/components/image-uploader/fileHelpers';
import { inferAssetTypeFromUrl } from '@/utils/mediaAssetType';

type UseQueuedImageReductionOptions = {
  queuedFiles: UploaderQueueItem[];
  updateQueuedFile: (id: string, updates: Partial<UploaderQueueItem>) => void;
  setPreviewFailures: Dispatch<SetStateAction<Record<string, boolean>>>;
};

const formatMb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

const clearRecordKey = (id: string) => (prev: Record<string, boolean>) => {
  const next = { ...prev };
  delete next[id];
  return next;
};

export function useQueuedImageReduction({
  queuedFiles,
  updateQueuedFile,
  setPreviewFailures,
}: UseQueuedImageReductionOptions) {
  const [reducingQueueItems, setReducingQueueItems] = useState<Record<string, boolean>>({});

  const clearReducingQueueItems = useCallback(() => {
    setReducingQueueItems({});
  }, []);

  const clearReducingQueueItem = useCallback((id: string) => {
    setReducingQueueItems(clearRecordKey(id));
  }, []);

  const reduceQueuedFileSize = useCallback(async (id: string) => {
    const target = queuedFiles.find((item) => item.id === id);
    if (!target) return;

    const effectiveAssetType =
      target.assetType ??
      (target.file ? inferAssetTypeFromFile(target.file) : inferAssetTypeFromUrl(target.remoteUrl));
    if (effectiveAssetType !== 'image') {
      updateQueuedFile(id, { processingNote: 'Size reduction supports images only' });
      return;
    }

    setReducingQueueItems((prev) => ({ ...prev, [id]: true }));
    try {
      let sourceFile = target.file;
      let sourceOriginalUrl: string | undefined;
      let serverProcessingNote: string | undefined;

      if (!sourceFile) {
        if (!target.remoteUrl) {
          updateQueuedFile(id, { processingNote: 'Size reduction skipped: no image source' });
          return;
        }
        const imported = await importRemoteQueueImage(target.remoteUrl);
        sourceFile = imported.file;
        sourceOriginalUrl = imported.originalUrl;
        serverProcessingNote = imported.processingNote;
      }

      if (!isImageFile(sourceFile)) {
        updateQueuedFile(id, { processingNote: 'Size reduction supports images only' });
        return;
      }

      let nextFile = sourceFile;
      let dimensions = target.metadata?.dimensions;
      let processingNote =
        serverProcessingNote ??
        (target.file ? `Already under 10MB (${formatMb(sourceFile.size)})` : `Prepared remote image (${formatMb(sourceFile.size)})`);

      if (sourceFile.size > MAX_UPLOAD_IMAGE_BYTES) {
        const reduced = await reduceImageFileToLimit(sourceFile, MAX_UPLOAD_IMAGE_BYTES);
        if (!reduced) {
          updateQueuedFile(id, {
            processingNote: 'Unable to reduce below 10MB',
          });
          return;
        }
        const ext = reduced.type === 'image/webp' ? '.webp' : '.jpg';
        const baseName = target.filename.replace(/\.[^.]+$/, '') || sourceFile.name.replace(/\.[^.]+$/, '') || 'reduced-image';
        const nextFilename = `${baseName}${ext}`;
        nextFile = new File([reduced.blob], nextFilename, { type: reduced.type });
        dimensions = { width: reduced.width, height: reduced.height };
        processingNote = reduced.note;
      }

      if (target.previewUrl && target.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(target.previewUrl);
      }

      updateQueuedFile(id, buildQueueReductionUpdate({
        target,
        nextFile,
        nextPreviewUrl: URL.createObjectURL(nextFile),
        processingNote,
        dimensions,
        originalUrl: sourceOriginalUrl,
      }));
      setPreviewFailures(clearRecordKey(id));
    } catch (error) {
      const message = error instanceof Error && error.message.trim() ? error.message : 'Unknown error';
      console.error('Failed to reduce file size', error);
      updateQueuedFile(id, {
        processingNote: `Size reduction failed: ${message}`,
      });
    } finally {
      setReducingQueueItems(clearRecordKey(id));
    }
  }, [queuedFiles, setPreviewFailures, updateQueuedFile]);

  return {
    reducingQueueItems,
    reduceQueuedFileSize,
    clearReducingQueueItem,
    clearReducingQueueItems,
  };
}
