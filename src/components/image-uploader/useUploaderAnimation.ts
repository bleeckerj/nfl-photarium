import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { NAMESPACE_REQUIRED_UPLOAD_ERROR } from '@/components/image-uploader/constants';
import type { UploadedImage } from '@/components/image-uploader/types';
import { base64ToFile, inferAssetTypeFromFile } from '@/components/image-uploader/fileHelpers';
import type { UploaderQueueItem } from '@/features/page-import/types';
import { inferAssetTypeFromUrl } from '@/utils/mediaAssetType';

interface UseUploaderAnimationOptions {
  queuedFiles: UploaderQueueItem[];
  selectedQueuedCount: number;
  uploadNamespace: string | null;
  tags: string;
  description: string;
  originalUrl: string;
  sourceUrl: string;
  selectedParentId: string;
  resolveFolder: () => string;
  setQueuedFiles: Dispatch<SetStateAction<UploaderQueueItem[]>>;
  setPreviewFailures: Dispatch<SetStateAction<Record<string, boolean>>>;
  setUploadedImages: Dispatch<SetStateAction<UploadedImage[]>>;
  notifyGalleryUploaded: () => void;
}

export function useUploaderAnimation({
  queuedFiles,
  selectedQueuedCount,
  uploadNamespace,
  tags,
  description,
  originalUrl,
  sourceUrl,
  selectedParentId,
  resolveFolder,
  setQueuedFiles,
  setPreviewFailures,
  setUploadedImages,
  notifyGalleryUploaded,
}: UseUploaderAnimationOptions) {
  const [animateFps, setAnimateFps] = useState('');
  const [animateFpsTouched, setAnimateFpsTouched] = useState(false);
  const [animateLoop, setAnimateLoop] = useState(true);
  const [animateFilename, setAnimateFilename] = useState('');
  const [animateLoading, setAnimateLoading] = useState(false);
  const [animateError, setAnimateError] = useState<string | null>(null);

  useEffect(() => {
    if (animateFpsTouched) return;
    if (selectedQueuedCount === 0) {
      setAnimateFps('');
      return;
    }
    const next = Math.max(1, selectedQueuedCount / 2);
    setAnimateFps(next.toString());
  }, [animateFpsTouched, selectedQueuedCount]);

  const handleCreateAnimation = useCallback(async () => {
    if (!uploadNamespace) {
      setAnimateError(NAMESPACE_REQUIRED_UPLOAD_ERROR);
      return;
    }

    const selectedItems = queuedFiles.filter((item) => {
      if (item.selected === false) return false;
      const effectiveAssetType = item.assetType ?? (item.file ? inferAssetTypeFromFile(item.file) : inferAssetTypeFromUrl(item.remoteUrl));
      return effectiveAssetType === 'image';
    });
    if (selectedItems.length < 2) {
      setAnimateError('Select at least two images to animate');
      return;
    }
    const fpsValue = Number(animateFps);
    if (!Number.isFinite(fpsValue) || fpsValue <= 0) {
      setAnimateError('FPS must be greater than 0');
      return;
    }
    setAnimateLoading(true);
    setAnimateError(null);

    try {
      const formData = new FormData();
      const folderToUse = resolveFolder();
      const itemsPayload: Array<{ kind: 'file'; fileIndex: number } | { kind: 'url'; url: string }> = [];
      const hydratedFrames: Array<{ id: string; file: File; previewUrl: string }> = [];
      const hydrationErrors: string[] = [];
      let fileIndex = 0;
      const getHost = (value: string) => {
        try {
          return new URL(value).host;
        } catch {
          return value;
        }
      };

      for (const item of selectedItems) {
        if (item.file) {
          formData.append('files', item.file);
          itemsPayload.push({ kind: 'file', fileIndex });
          fileIndex += 1;
        } else if (item.remoteUrl) {
          let hydratedFile: File | null = null;
          try {
            const importResponse = await fetch('/api/import', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: item.remoteUrl }),
            });
            const importData = await importResponse.json();
            if (importResponse.ok && importData?.data && importData?.type) {
              const importName =
                typeof importData.name === 'string' && importData.name.trim()
                  ? importData.name.trim()
                  : item.filename || 'remote-frame';
              hydratedFile = base64ToFile(String(importData.data), importName, String(importData.type));
            } else {
              const detail = typeof importData?.error === 'string'
                ? importData.error
                : `HTTP ${importResponse.status}`;
              hydrationErrors.push(`${getHost(item.remoteUrl)}: ${detail}`);
            }
          } catch (error) {
            const detail = error instanceof Error ? error.message : 'Network error';
            hydrationErrors.push(`${getHost(item.remoteUrl)}: ${detail}`);
          }

          if (hydratedFile) {
            formData.append('files', hydratedFile, hydratedFile.name);
            itemsPayload.push({ kind: 'file', fileIndex });
            fileIndex += 1;
            hydratedFrames.push({
              id: item.id,
              file: hydratedFile,
              previewUrl: URL.createObjectURL(hydratedFile),
            });
          } else {
            itemsPayload.push({ kind: 'url', url: item.remoteUrl });
          }
        }
      }

      if (itemsPayload.length < 2) {
        const hydrationContext = hydrationErrors.length
          ? ` Failed frame prep: ${hydrationErrors.slice(0, 3).join(' | ')}`
          : '';
        setAnimateError(`Select at least two valid images to animate.${hydrationContext}`);
        return;
      }

      formData.append('items', JSON.stringify(itemsPayload));
      formData.append('fps', String(fpsValue));
      formData.append('loop', animateLoop ? '1' : '0');
      if (animateFilename.trim()) formData.append('filename', animateFilename.trim());
      if (folderToUse && folderToUse.trim()) formData.append('folder', folderToUse.trim());
      if (tags.trim()) formData.append('tags', tags.trim());
      if (description.trim()) formData.append('description', description.trim());
      if (originalUrl.trim()) formData.append('originalUrl', originalUrl.trim());
      if (sourceUrl.trim()) formData.append('sourceUrl', sourceUrl.trim());
      formData.append('namespace', uploadNamespace);
      if (selectedParentId) formData.append('parentId', selectedParentId);

      const response = await fetch('/api/animate', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) {
        const details = Array.isArray(data?.details)
          ? data.details.filter((entry: unknown): entry is string => typeof entry === 'string' && entry.trim().length > 0).slice(0, 4)
          : [];
        const frameCounts =
          typeof data?.validFrames === 'number' && typeof data?.totalRequested === 'number'
            ? ` (usable ${data.validFrames}/${data.totalRequested} frames)`
            : '';
        const detailText = details.length ? ` Details: ${details.join(' | ')}` : '';
        throw new Error(`${data.error || 'Failed to create animation'}${frameCounts}${detailText}`);
      }

      if (hydratedFrames.length > 0) {
        const hydratedById = new Map(hydratedFrames.map((entry) => [entry.id, entry]));
        setQueuedFiles((prev) =>
          prev.map((queued) => {
            const hydrated = hydratedById.get(queued.id);
            if (!hydrated) return queued;
            if (queued.previewUrl && queued.previewUrl.startsWith('blob:')) {
              URL.revokeObjectURL(queued.previewUrl);
            }
            return {
              ...queued,
              file: hydrated.file,
              previewUrl: hydrated.previewUrl,
              sizeBytes: queued.sizeBytes ?? hydrated.file.size,
              contentType: queued.contentType ?? hydrated.file.type,
              processingNote: 'Frame cached locally for animation',
            };
          })
        );
        setPreviewFailures((prev) => {
          const next = { ...prev };
          hydratedFrames.forEach((entry) => {
            delete next[entry.id];
          });
          return next;
        });
      }

      setUploadedImages((prev) => [
        ...prev,
        {
          id: data.id,
          assetType: 'image',
          url: data.url,
          filename: data.filename,
          status: 'success',
          folder: data.folder,
          tags: data.tags,
          description: data.description,
          originalUrl: data.originalUrl,
          sourceUrl: data.sourceUrl,
        },
      ]);

      notifyGalleryUploaded();
    } catch (err) {
      console.error('Create animation failed', err);
      setAnimateError(err instanceof Error ? err.message : 'Failed to create animation');
    } finally {
      setAnimateLoading(false);
    }
  }, [
    animateFilename,
    animateFps,
    animateLoop,
    description,
    notifyGalleryUploaded,
    originalUrl,
    queuedFiles,
    resolveFolder,
    selectedParentId,
    setPreviewFailures,
    setQueuedFiles,
    setUploadedImages,
    sourceUrl,
    tags,
    uploadNamespace,
  ]);

  return {
    animateFps,
    setAnimateFps,
    animateFpsTouched,
    setAnimateFpsTouched,
    animateLoop,
    setAnimateLoop,
    animateFilename,
    setAnimateFilename,
    animateLoading,
    animateError,
    handleCreateAnimation,
  };
}
