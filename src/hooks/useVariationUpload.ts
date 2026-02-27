import { useCallback, useEffect, useState } from 'react';
import { importVariationFromUrl, uploadVariationFile, uploadVariationUrl } from '@/services/variationUploadService';

export type VariationUploadToast = {
  push: (message: string) => void;
};

type UploadFailureItem = {
  filename?: string;
  error?: string;
  duplicates?: Array<{ filename?: string; folder?: string }>;
};

type UseVariationUploadParams = {
  imageId?: string;
  imageFolder?: string;
  imageTags?: string[];
  imageNamespace?: string;
  refreshImageList: () => Promise<void>;
  toast: VariationUploadToast;
};

const formatFailureNames = (failures: UploadFailureItem[]) => {
  const names = failures.map((failure) => failure.filename || 'unknown');
  const preview = names.slice(0, 3).join(', ');
  if (names.length <= 3) {
    return preview;
  }
  return `${preview} +${names.length - 3} more`;
};

const formatDuplicateMessage = (failure: UploadFailureItem, fallback?: string) => {
  const duplicates = Array.isArray(failure.duplicates) ? failure.duplicates : [];
  if (!duplicates.length) return undefined;
  const summary = duplicates
    .map((dup) => {
      const label = dup.filename || 'Untitled';
      return dup.folder ? `${label} (${dup.folder})` : label;
    })
    .slice(0, 3)
    .join(', ');
  const extra = duplicates.length > 3 ? '…' : '';
  return `${fallback || failure.error || 'Duplicate detected.'} Existing: ${summary}${extra}`;
};

export function useVariationUpload({
  imageId,
  imageFolder,
  imageTags,
  imageNamespace,
  refreshImageList,
  toast
}: UseVariationUploadParams) {
  const [childUploadFiles, setChildUploadFiles] = useState<File[]>([]);
  const [childUploadTags, setChildUploadTags] = useState('');
  const [childUploadFolder, setChildUploadFolder] = useState('');
  const [childUploadLoading, setChildUploadLoading] = useState(false);
  const [childUploadUrl, setChildUploadUrl] = useState('');
  const [childUploadUrlLoading, setChildUploadUrlLoading] = useState(false);
  const [childImportUrl, setChildImportUrl] = useState('');
  const [childImportLoading, setChildImportLoading] = useState(false);
  const [childImportError, setChildImportError] = useState<string | null>(null);

  useEffect(() => {
    setChildUploadFolder(imageFolder || '');
    setChildUploadTags(Array.isArray(imageTags) ? imageTags.join(', ') : '');
  }, [imageFolder, imageTags]);

  const handleChildUpload = useCallback(async () => {
    if (!imageId || childUploadFiles.length === 0) return;
    const resolvedNamespace = imageNamespace?.trim();
    if (!resolvedNamespace) {
      toast.push('Select a specific namespace before uploading variations.');
      return;
    }
    setChildUploadLoading(true);
    try {
      const defaultFolder = childUploadFolder.trim();
      const defaultTags = childUploadTags.trim();
      let successCount = 0;
      const failures: UploadFailureItem[] = [];
      const skipped: UploadFailureItem[] = [];

      for (const file of childUploadFiles) {
        const { ok, payload } = await uploadVariationFile({
          file,
          folder: defaultFolder || undefined,
          tags: defaultTags || undefined,
          namespace: resolvedNamespace,
          parentId: imageId
        });

        if (!ok) {
          failures.push({
            filename: file.name,
            error: payload.error || 'Upload failed',
            duplicates: payload.duplicates
          });
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
        } else {
          successCount += 1;
        }
      }

      if (successCount > 0) {
        toast.push(`Uploaded ${successCount} variation(s)`);
        await refreshImageList();
      } else {
        toast.push('No variations uploaded');
      }

      if (failures.length) {
        const duplicateFailure = failures.find((failure) => Array.isArray(failure.duplicates) && failure.duplicates.length > 0);
        const duplicateMessage = duplicateFailure ? formatDuplicateMessage(duplicateFailure) : undefined;
        toast.push(duplicateMessage || `Failed: ${formatFailureNames(failures)}`);
      }
      if (skipped.length) {
        toast.push(`Skipped: ${formatFailureNames(skipped)}`);
      }

      setChildUploadFiles([]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to upload variation';
      toast.push(message);
    } finally {
      setChildUploadLoading(false);
    }
  }, [childUploadFiles, childUploadFolder, childUploadTags, imageId, imageNamespace, refreshImageList, toast]);

  const handleChildUploadByUrl = useCallback(async () => {
    if (!imageId) return;
    const resolvedNamespace = imageNamespace?.trim();
    if (!resolvedNamespace) {
      toast.push('Select a specific namespace before uploading variations.');
      return;
    }
    const trimmedUrl = childUploadUrl.trim();
    if (!trimmedUrl) return;
    setChildUploadUrlLoading(true);
    try {
      const defaultFolder = childUploadFolder.trim();
      const defaultTags = childUploadTags.trim();

      const { ok, payload } = await uploadVariationUrl({
        url: trimmedUrl,
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
      } else {
        toast.push('No variations uploaded');
      }

      if (failures.length) {
        const duplicateFailure = failures.find((failure) => Array.isArray(failure.duplicates) && failure.duplicates.length > 0);
        const duplicateMessage = duplicateFailure ? formatDuplicateMessage(duplicateFailure) : undefined;
        toast.push(duplicateMessage || `Failed: ${formatFailureNames(failures)}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to upload URL';
      toast.push(message);
    } finally {
      setChildUploadUrlLoading(false);
    }
  }, [childUploadFolder, childUploadTags, childUploadUrl, imageId, imageNamespace, refreshImageList, toast]);

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
      setChildUploadFiles((prev) => [...prev, file]);
      setChildImportUrl('');
    } catch (error) {
      setChildImportError(error instanceof Error ? error.message : 'Failed to import image');
    } finally {
      setChildImportLoading(false);
    }
  }, [childImportUrl, setChildUploadFiles]);

  return {
    childUploadFiles,
    setChildUploadFiles,
    childUploadTags,
    childUploadFolder,
    childUploadLoading,
    childUploadUrl,
    childUploadUrlLoading,
    setChildUploadUrl,
    childImportUrl,
    childImportLoading,
    childImportError,
    setChildImportUrl,
    handleImportFromUrl,
    handleChildUpload,
    handleChildUploadByUrl
  };
}
