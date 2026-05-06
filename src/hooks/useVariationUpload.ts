import { useCallback, useEffect, useState } from 'react';
import { importVariationFromUrl, uploadVariationFile, uploadVariationUrl } from '@/services/variationUploadService';
import {
  formatDuplicateMessage,
  formatFailureNames,
  formatFailureSummary,
  resolveUploadFilename,
  type VariationUploadFailureItem,
} from '@/hooks/variationUploadUtils';

export type VariationUploadToast = {
  push: (message: string) => void;
};

type UseVariationUploadParams = {
  imageId?: string;
  imageFolder?: string;
  imageTags?: string[];
  imageNamespace?: string;
  refreshImageList: () => Promise<void>;
  toast: VariationUploadToast;
};

export type VariationUploadQueueItem = {
  id: string;
  file: File;
  filename: string;
};

const generateQueueItemId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const createQueueItem = (file: File): VariationUploadQueueItem => ({
  id: generateQueueItemId(),
  file,
  filename: file.name,
});

export function useVariationUpload({
  imageId,
  imageFolder,
  imageTags,
  imageNamespace,
  refreshImageList,
  toast
}: UseVariationUploadParams) {
  const [childUploadItems, setChildUploadItems] = useState<VariationUploadQueueItem[]>([]);
  const [childUploadTags, setChildUploadTags] = useState('');
  const [childUploadFolder, setChildUploadFolder] = useState('');
  const [childUploadLoading, setChildUploadLoading] = useState(false);
  const [childUploadUrl, setChildUploadUrl] = useState('');
  const [childUploadUrlFilename, setChildUploadUrlFilename] = useState('');
  const [childUploadUrlLoading, setChildUploadUrlLoading] = useState(false);
  const [childImportUrl, setChildImportUrl] = useState('');
  const [childImportLoading, setChildImportLoading] = useState(false);
  const [childImportError, setChildImportError] = useState<string | null>(null);

  useEffect(() => {
    setChildUploadFolder(imageFolder || '');
    setChildUploadTags(Array.isArray(imageTags) ? imageTags.join(', ') : '');
  }, [imageFolder, imageTags]);

  const appendChildUploadFiles = useCallback((files: File[]) => {
    if (files.length === 0) return;
    setChildUploadItems((prev) => [...prev, ...files.map(createQueueItem)]);
  }, []);

  const clearChildUploadFiles = useCallback(() => {
    setChildUploadItems([]);
  }, []);

  const updateChildUploadFilename = useCallback((id: string, filename: string) => {
    setChildUploadItems((prev) => prev.map((item) => (
      item.id === id ? { ...item, filename } : item
    )));
  }, []);

  const handleChildUpload = useCallback(async () => {
    if (!imageId || childUploadItems.length === 0) return;
    const resolvedNamespace = imageNamespace?.trim() || undefined;
    setChildUploadLoading(true);
    try {
      const defaultFolder = childUploadFolder.trim();
      const defaultTags = childUploadTags.trim();
      let successCount = 0;
      const failures: VariationUploadFailureItem[] = [];
      const skipped: VariationUploadFailureItem[] = [];
      const remainingItems: VariationUploadQueueItem[] = [];

      for (const item of childUploadItems) {
        const resolvedFilename = resolveUploadFilename(item.filename, item.file.name);
        const displayName = item.filename.trim() || undefined;
        const { ok, payload } = await uploadVariationFile({
          file: item.file,
          filename: resolvedFilename,
          displayName,
          folder: defaultFolder || undefined,
          tags: defaultTags || undefined,
          namespace: resolvedNamespace,
          parentId: imageId
        });

        if (!ok) {
          failures.push({
            filename: resolvedFilename,
            error: payload.error || 'Upload failed',
            duplicates: payload.duplicates
          });
          remainingItems.push(item);
          continue;
        }

        if (payload && Array.isArray(payload.results)) {
          successCount += payload.results.length;
          if (Array.isArray(payload.failures)) {
            failures.push(...payload.failures);
          }
          if (Array.isArray(payload.skipped)) {
            skipped.push(...payload.skipped);
          }
          if (payload.results.length === 0) {
            remainingItems.push(item);
          }
        } else {
          successCount += 1;
        }
      }

      if (successCount > 0) {
        toast.push(`Uploaded ${successCount} variation(s)`);
        await refreshImageList();
      } else if (failures.length === 0 && skipped.length === 0) {
        toast.push('No variations uploaded');
      }

      if (failures.length) {
        const duplicateFailure = failures.find((failure) => Array.isArray(failure.duplicates) && failure.duplicates.length > 0);
        const duplicateMessage = duplicateFailure ? formatDuplicateMessage(duplicateFailure) : undefined;
        toast.push(duplicateMessage || `Failed: ${formatFailureSummary(failures)}`);
      }
      if (skipped.length) {
        toast.push(`Skipped: ${formatFailureNames(skipped)}`);
      }

      setChildUploadItems(remainingItems);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to upload variation';
      toast.push(message);
    } finally {
      setChildUploadLoading(false);
    }
  }, [childUploadFolder, childUploadItems, childUploadTags, imageId, imageNamespace, refreshImageList, toast]);

  const handleChildUploadByUrl = useCallback(async () => {
    if (!imageId) return;
    const resolvedNamespace = imageNamespace?.trim() || undefined;
    const trimmedUrl = childUploadUrl.trim();
    if (!trimmedUrl) return;
    setChildUploadUrlLoading(true);
    try {
      const defaultFolder = childUploadFolder.trim();
      const defaultTags = childUploadTags.trim();
      const resolvedFilename = resolveUploadFilename(childUploadUrlFilename, trimmedUrl);
      const displayName = childUploadUrlFilename.trim() || undefined;

      const { ok, payload } = await uploadVariationUrl({
        url: trimmedUrl,
        filename: resolvedFilename === trimmedUrl ? undefined : resolvedFilename,
        displayName,
        folder: defaultFolder || undefined,
        tags: defaultTags || undefined,
        namespace: resolvedNamespace,
        originalUrl: trimmedUrl,
        parentId: imageId
      });

      if (!ok) {
        toast.push(payload?.error || 'Failed to upload URL');
        return;
      }

      const results = Array.isArray(payload?.results) ? payload.results : [];
      const failures = Array.isArray(payload?.failures) ? payload.failures : [];

      if (results.length > 0) {
        toast.push(`Uploaded ${results.length} variation(s)`);
        await refreshImageList();
        setChildUploadUrl('');
        setChildUploadUrlFilename('');
      } else if (failures.length === 0) {
        toast.push('No variations uploaded');
      }

      if (failures.length) {
        const duplicateFailure = failures.find((failure) => Array.isArray(failure.duplicates) && failure.duplicates.length > 0);
        const duplicateMessage = duplicateFailure ? formatDuplicateMessage(duplicateFailure) : undefined;
        toast.push(duplicateMessage || `Failed: ${formatFailureSummary(failures)}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to upload URL';
      toast.push(message);
    } finally {
      setChildUploadUrlLoading(false);
    }
  }, [childUploadFolder, childUploadTags, childUploadUrl, childUploadUrlFilename, imageId, imageNamespace, refreshImageList, toast]);

  const handleImportFromUrl = useCallback(async () => {
    if (!childImportUrl.trim()) return;
    setChildImportLoading(true);
    setChildImportError(null);
    try {
      const { ok, payload, file } = await importVariationFromUrl({ url: childImportUrl.trim() });
      if (!ok || !file) {
        setChildImportError(payload?.error || 'Failed to import image');
        return;
      }
      appendChildUploadFiles([file]);
      setChildImportUrl('');
    } catch (error) {
      setChildImportError(error instanceof Error ? error.message : 'Failed to import image');
    } finally {
      setChildImportLoading(false);
    }
  }, [appendChildUploadFiles, childImportUrl]);

  return {
    childUploadItems,
    appendChildUploadFiles,
    clearChildUploadFiles,
    updateChildUploadFilename,
    childUploadTags,
    childUploadFolder,
    childUploadLoading,
    childUploadUrl,
    childUploadUrlFilename,
    childUploadUrlLoading,
    setChildUploadUrl,
    setChildUploadUrlFilename,
    childImportUrl,
    childImportLoading,
    childImportError,
    setChildImportUrl,
    handleImportFromUrl,
    handleChildUpload,
    handleChildUploadByUrl
  };
}
