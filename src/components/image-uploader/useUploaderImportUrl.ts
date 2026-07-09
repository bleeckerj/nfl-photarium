import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import { base64ToFile } from '@/components/image-uploader/fileHelpers';
import { createImageFileFromDataUrl, isDataUrl } from '@/components/image-uploader/dataUrlImport';
import type { UploaderQueueItem } from '@/features/page-import/types';
import { inferAssetTypeFromUrl, isImageOnlyImportError } from '@/utils/mediaAssetType';

interface UseUploaderImportUrlOptions {
  createQueueId: () => string;
  originalUrl: string;
  setOriginalUrl: Dispatch<SetStateAction<string>>;
  setQueuedFiles: Dispatch<SetStateAction<UploaderQueueItem[]>>;
}

export function useUploaderImportUrl({
  createQueueId,
  originalUrl,
  setOriginalUrl,
  setQueuedFiles,
}: UseUploaderImportUrlOptions) {
  const [importUrl, setImportUrl] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const queueRemoteVideo = useCallback((sourceUrl: string) => {
    setQueuedFiles((prev) => [
      ...prev,
      {
        id: createQueueId(),
        assetType: 'video',
        filename: sourceUrl.split('/').pop() || 'remote-video',
        remoteUrl: sourceUrl,
        originalUrl: sourceUrl,
        selected: true,
      },
    ]);
    if (!originalUrl.trim()) {
      setOriginalUrl(sourceUrl);
    }
    setImportUrl('');
  }, [createQueueId, originalUrl, setOriginalUrl, setQueuedFiles]);

  const handleImportFromUrl = useCallback(async () => {
    const sourceUrl = importUrl.trim();
    if (!sourceUrl) return;
    try {
      setImportLoading(true);
      setImportError(null);
      if (isDataUrl(sourceUrl)) {
        const file = createImageFileFromDataUrl(sourceUrl);
        const objectUrl = URL.createObjectURL(file);
        setQueuedFiles((prev) => [
          ...prev,
          {
            id: createQueueId(),
            assetType: 'image',
            file,
            filename: file.name,
            previewUrl: objectUrl,
            selected: true,
          },
        ]);
        setImportUrl('');
        return;
      }

      const inferredAssetType = inferAssetTypeFromUrl(sourceUrl);
      if (inferredAssetType === 'video') {
        queueRemoteVideo(sourceUrl);
        return;
      }

      const response = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: sourceUrl }),
      });
      const data = await response.json();
      if (!response.ok) {
        const errorMessage = data?.error || 'Failed to import image';
        if (isImageOnlyImportError(errorMessage)) {
          queueRemoteVideo(sourceUrl);
          return;
        }
        throw new Error(errorMessage);
      }
      if (!data?.data || !data?.type || !data?.name) {
        throw new Error('Invalid response from import service');
      }
      const file = base64ToFile(String(data.data), String(data.name), String(data.type));
      const importedSourceUrl = String(data.originalUrl || sourceUrl);
      const descriptionFromSnagx = typeof data.snagxDescription === 'string' && data.snagxDescription.trim()
        ? data.snagxDescription.trim()
        : '';
      const tagsFromSnagx = data.snagxDescription || data.captureDate ? 'snagx' : undefined;
      setQueuedFiles((prev) => [
        ...prev,
        {
          id: createQueueId(),
          assetType: 'image',
          file,
          filename: file.name,
          originalUrl: importedSourceUrl,
          description: descriptionFromSnagx || undefined,
          captureDate: typeof data.captureDate === 'string' ? data.captureDate : undefined,
          tags: tagsFromSnagx,
          previewUrl: URL.createObjectURL(file),
          selected: true,
        },
      ]);
      if (!originalUrl.trim()) {
        setOriginalUrl(importedSourceUrl);
      }
      setImportUrl('');
    } catch (err) {
      console.error('Import image failed', err);
      setImportError(err instanceof Error ? err.message : 'Failed to import media');
    } finally {
      setImportLoading(false);
    }
  }, [createQueueId, importUrl, originalUrl, queueRemoteVideo, setOriginalUrl, setQueuedFiles]);

  return {
    importUrl,
    setImportUrl,
    importLoading,
    importError,
    handleImportFromUrl,
  };
}
