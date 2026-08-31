import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import { base64ToFile } from '@/components/image-uploader/fileHelpers';
import { createImageFileFromDataUrl, isDataUrl } from '@/components/image-uploader/dataUrlImport';
import type { UploaderQueueItem } from '@/features/page-import/types';
import { parseUrlLines } from '@/features/page-import/utils/urlManifest';
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

  const buildRemoteQueueItem = useCallback((sourceUrl: string): UploaderQueueItem => {
    const assetType = inferAssetTypeFromUrl(sourceUrl);
    const filename = (() => {
      try {
        const pathname = new URL(sourceUrl).pathname;
        return decodeURIComponent(pathname.split('/').pop() || '') || (assetType === 'video' ? 'remote-video' : 'remote-image');
      } catch {
        return assetType === 'video' ? 'remote-video' : 'remote-image';
      }
    })();
    return {
      id: createQueueId(),
      assetType,
      filename,
      remoteUrl: sourceUrl,
      previewUrl: assetType === 'image' ? sourceUrl : undefined,
      originalUrl: sourceUrl,
      selected: true,
    };
  }, [createQueueId]);

  const queueRemoteVideo = useCallback((sourceUrl: string) => {
    setQueuedFiles((prev) => [...prev, buildRemoteQueueItem(sourceUrl)]);
    if (!originalUrl.trim()) {
      setOriginalUrl(sourceUrl);
    }
    setImportUrl('');
  }, [buildRemoteQueueItem, originalUrl, setOriginalUrl, setQueuedFiles]);

  const queueRemoteUrlList = useCallback((value: string) => {
    const manifest = parseUrlLines(value);
    const items = manifest.urls.map(buildRemoteQueueItem);
    setQueuedFiles((prev) => {
      const existing = new Set(prev.map((item) => item.remoteUrl || item.originalUrl || item.filename));
      const incoming = new Set<string>();
      const uniqueItems = items.filter((item) => {
        const key = item.remoteUrl || item.originalUrl || item.filename;
        if (existing.has(key) || incoming.has(key)) return false;
        incoming.add(key);
        return true;
      });
      return [...prev, ...uniqueItems];
    });
    if (!originalUrl.trim() && manifest.urls[0]) {
      setOriginalUrl(manifest.urls[0]);
    }
    setImportUrl('');
    const warnings = [
      manifest.invalidCount ? `${manifest.invalidCount} invalid line${manifest.invalidCount === 1 ? '' : 's'} skipped` : '',
      manifest.duplicateCount ? `${manifest.duplicateCount} duplicate${manifest.duplicateCount === 1 ? '' : 's'} skipped` : '',
    ].filter(Boolean);
    if (warnings.length > 0) {
      setImportError(warnings.join('; '));
    }
  }, [buildRemoteQueueItem, originalUrl, setOriginalUrl, setQueuedFiles]);

  const handleImportFromUrl = useCallback(async () => {
    const sourceUrl = importUrl.trim();
    if (!sourceUrl) return;
    try {
      setImportLoading(true);
      setImportError(null);
      if (/\r?\n/.test(sourceUrl)) {
        queueRemoteUrlList(sourceUrl);
        return;
      }
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
  }, [createQueueId, importUrl, originalUrl, queueRemoteUrlList, queueRemoteVideo, setOriginalUrl, setQueuedFiles]);

  return {
    importUrl,
    setImportUrl,
    importLoading,
    importError,
    handleImportFromUrl,
  };
}
