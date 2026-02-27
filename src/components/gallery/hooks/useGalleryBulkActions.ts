import { useCallback } from 'react';
import type { CloudflareImage } from '../types';
import { truncateMiddle } from '@/components/gallery/utils';

interface UseGalleryBulkActionsOptions {
  images: CloudflareImage[];
  setImages: React.Dispatch<React.SetStateAction<CloudflareImage[]>>;
  toastPush: (message: string) => void;
  selectedCount: number;
  selectedImageIds: Set<string>;
  clearSelection: () => void;
  setBulkSelectionMode: (value: boolean) => void;
  setBulkEditOpen: (value: boolean) => void;
  setBulkAnimateFilename: (value: string) => void;
  setBulkAnimateFps: (value: string) => void;
  setBulkAnimateLoop: (value: boolean) => void;
  setBulkAnimateTouched: (value: boolean) => void;
  bulkApplyFolder: boolean;
  bulkApplyTags: boolean;
  bulkFolderInput: string;
  bulkTagsInput: string;
  bulkTagsMode: 'replace' | 'append';
  bulkApplyDisplayName: boolean;
  bulkDisplayNameInput: string;
  bulkDisplayNameMode: 'custom' | 'auto' | 'clear' | 'ai';
  bulkApplyDescription: boolean;
  bulkDescriptionAppendInput: string;
  bulkApplyNamespace: boolean;
  bulkNamespaceInput: string;
  bulkFolderMode: 'existing' | 'new';
  setBulkUpdating: (value: boolean) => void;
  setBulkDeleting: (value: boolean) => void;
  setBulkEmbeddingGenerating: (value: boolean) => void;
  setBulkAnimateLoading: (value: boolean) => void;
  setBulkAnimateError: (value: string | null) => void;
  bulkAnimateFps: string;
  bulkAnimateFilename: string;
  bulkAnimateLoop: boolean;
  namespace?: string;
  fetchImages: (options?: { silent?: boolean; forceRefresh?: boolean }) => Promise<void>;
}

export const useGalleryBulkActions = ({
  images,
  setImages,
  toastPush,
  selectedCount,
  selectedImageIds,
  clearSelection,
  setBulkSelectionMode,
  setBulkEditOpen,
  setBulkAnimateFilename,
  setBulkAnimateFps,
  setBulkAnimateLoop,
  setBulkAnimateTouched,
  bulkApplyFolder,
  bulkApplyTags,
  bulkFolderInput,
  bulkTagsInput,
  bulkTagsMode,
  bulkApplyDisplayName,
  bulkDisplayNameInput,
  bulkDisplayNameMode,
  bulkApplyDescription,
  bulkDescriptionAppendInput,
  bulkApplyNamespace,
  bulkNamespaceInput,
  bulkFolderMode,
  setBulkUpdating,
  setBulkDeleting,
  setBulkEmbeddingGenerating,
  setBulkAnimateLoading,
  setBulkAnimateError,
  bulkAnimateFps,
  bulkAnimateFilename,
  bulkAnimateLoop,
  namespace,
  fetchImages,
}: UseGalleryBulkActionsOptions) => {
  const applyBulkUpdates = useCallback(async () => {
    if (!selectedCount) {
      toastPush('No images selected');
      return;
    }
    const parsedBulkTags = bulkTagsInput
      .split(',')
      .map(tag => tag.trim())
      .filter(Boolean);
    const hasTagChanges =
      bulkApplyTags &&
      (bulkTagsMode === 'replace' || parsedBulkTags.length > 0);
    const hasDisplayNameChanges = bulkApplyDisplayName;
    const descriptionAppendText = bulkDescriptionAppendInput.trim();
    const hasDescriptionChanges = bulkApplyDescription && descriptionAppendText.length > 0;
    const hasNamespaceChanges = bulkApplyNamespace;
    if (!bulkApplyFolder && !hasTagChanges && !hasDisplayNameChanges && !hasDescriptionChanges && !hasNamespaceChanges) {
      toastPush('Choose at least one field to update');
      return;
    }
    setBulkUpdating(true);
    try {
      const wantsAiDisplayName = bulkApplyDisplayName && bulkDisplayNameMode === 'ai';
      const generatedDisplayNames = new Map<string, string>();
      let aiSuccessCount = 0;
      let aiFailureCount = 0;
      await Promise.all(
        Array.from(selectedImageIds).map(async id => {
          const payload: Record<string, unknown> = {};
          if (bulkApplyFolder) {
            if (bulkFolderMode === 'existing') {
              payload.folder = bulkFolderInput || undefined;
            } else if (bulkFolderMode === 'new') {
              payload.folder = bulkFolderInput.trim() || undefined;
            }
          }
          if (bulkApplyTags) {
            if (bulkTagsMode === 'replace') {
              payload.tags = bulkTagsInput;
            } else if (parsedBulkTags.length > 0) {
              const target = images.find(img => img.id === id);
              const existingTags = Array.isArray(target?.tags) ? target.tags : [];
              const merged = new Map<string, string>();
              existingTags.forEach(tag => merged.set(tag.toLowerCase(), tag));
              parsedBulkTags.forEach(tag => merged.set(tag.toLowerCase(), tag));
              payload.tags = Array.from(merged.values());
            }
          }
          if (bulkApplyDisplayName) {
            if (bulkDisplayNameMode === 'clear') {
              payload.displayName = '';
            } else if (bulkDisplayNameMode === 'custom') {
              payload.displayName = bulkDisplayNameInput.trim();
            } else if (bulkDisplayNameMode === 'auto') {
              const target = images.find(img => img.id === id);
              const baseName = target?.filename || '';
              payload.displayName = truncateMiddle(baseName, 64);
            } else if (bulkDisplayNameMode === 'ai') {
              try {
                const response = await fetch(`/api/images/${id}/display-name`, { method: 'POST' });
                const data = await response.json();
                if (response.ok && data?.displayName) {
                  payload.displayName = data.displayName;
                  generatedDisplayNames.set(id, data.displayName);
                  aiSuccessCount += 1;
                } else {
                  aiFailureCount += 1;
                }
              } catch (error) {
                console.error('Failed to generate display name', error);
                aiFailureCount += 1;
              }
            }
          }
          if (hasDescriptionChanges) {
            const target = images.find(img => img.id === id);
            const currentDescription = (target?.description || '').trim();
            payload.description = currentDescription
              ? `${currentDescription}\n\n${descriptionAppendText}`
              : descriptionAppendText;
          }
          if (bulkApplyNamespace) {
            payload.namespace = bulkNamespaceInput.trim() || '';
          }
          if (!Object.keys(payload).length) {
            return null;
          }
          return fetch(`/api/images/${id}/update`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
        })
      );
      setImages(prev =>
        prev.map(img => {
          if (!selectedImageIds.has(img.id)) {
            return img;
          }
          const updatedFolder: string | undefined =
            bulkApplyFolder
              ? (bulkFolderMode === 'existing'
                  ? bulkFolderInput || undefined
                  : bulkFolderInput.trim() || undefined)
              : undefined;
          let updatedTags = img.tags;
          if (bulkApplyTags) {
            if (bulkTagsMode === 'replace') {
              updatedTags = parsedBulkTags;
            } else if (parsedBulkTags.length > 0) {
              const merged = new Map<string, string>();
              (img.tags ?? []).forEach(tag => merged.set(tag.toLowerCase(), tag));
              parsedBulkTags.forEach(tag => merged.set(tag.toLowerCase(), tag));
              updatedTags = Array.from(merged.values());
            }
          }
          let updatedDisplayName = img.displayName;
          if (bulkApplyDisplayName) {
            if (bulkDisplayNameMode === 'clear') {
              updatedDisplayName = '';
            } else if (bulkDisplayNameMode === 'custom') {
              updatedDisplayName = bulkDisplayNameInput.trim();
            } else if (bulkDisplayNameMode === 'auto') {
              updatedDisplayName = truncateMiddle(img.filename || '', 64);
            } else if (bulkDisplayNameMode === 'ai') {
              updatedDisplayName = generatedDisplayNames.get(img.id) ?? updatedDisplayName;
            }
          }
          const updatedDescription = hasDescriptionChanges
            ? ((img.description || '').trim()
              ? `${(img.description || '').trim()}\n\n${descriptionAppendText}`
              : descriptionAppendText)
            : img.description;
          const updatedNamespace = bulkApplyNamespace ? (bulkNamespaceInput.trim() || undefined) : img.namespace;

          return {
            ...img,
            folder: bulkApplyFolder ? updatedFolder : img.folder,
            tags: updatedTags,
            displayName: updatedDisplayName,
            description: updatedDescription,
            namespace: updatedNamespace
          };
        })
      );
      if (wantsAiDisplayName) {
        const total = selectedImageIds.size;
        if (aiSuccessCount === 0) {
          toastPush('No display names generated');
        } else if (aiSuccessCount < total || aiFailureCount > 0) {
          toastPush(`Generated display names for ${aiSuccessCount}/${total} images`);
        } else {
          toastPush('Display names generated');
        }
      }
      toastPush('Images updated');
      clearSelection();
      setBulkSelectionMode(false);
      setBulkEditOpen(false);
    } catch (error) {
      console.error('Bulk update failed', error);
      toastPush('Bulk update failed');
    } finally {
      setBulkUpdating(false);
    }
  }, [
    bulkApplyDisplayName,
    bulkApplyDescription,
    bulkApplyFolder,
    bulkApplyNamespace,
    bulkApplyTags,
    bulkDescriptionAppendInput,
    bulkDisplayNameInput,
    bulkDisplayNameMode,
    bulkFolderInput,
    bulkFolderMode,
    bulkNamespaceInput,
    bulkTagsInput,
    bulkTagsMode,
    clearSelection,
    images,
    selectedCount,
    selectedImageIds,
    setBulkEditOpen,
    setBulkSelectionMode,
    setBulkUpdating,
    setImages,
    toastPush
  ]);

  const createBulkAnimation = useCallback(async () => {
    if (selectedCount < 2) {
      toastPush('Select at least two images');
      return;
    }
    const fpsValue = Number(bulkAnimateFps);
    if (!Number.isFinite(fpsValue) || fpsValue <= 0) {
      setBulkAnimateError('FPS must be greater than 0');
      return;
    }
    setBulkAnimateLoading(true);
    setBulkAnimateError(null);
    try {
      const response = await fetch('/api/animate/selection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: Array.from(selectedImageIds),
          fps: fpsValue,
          loop: bulkAnimateLoop,
          filename: bulkAnimateFilename.trim() || undefined,
          namespace
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create animation');
      }
      setBulkEditOpen(false);
      setBulkAnimateFilename('');
      setBulkAnimateFps('');
      setBulkAnimateLoop(true);
      setBulkAnimateTouched(false);
      toastPush(`Animation created (${data.id ?? 'new'})`);
      await fetchImages({ forceRefresh: true });
    } catch (error) {
      console.error('Bulk animation failed', error);
      setBulkAnimateError(error instanceof Error ? error.message : 'Failed to create animation');
    } finally {
      setBulkAnimateLoading(false);
    }
  }, [
    bulkAnimateFilename,
    bulkAnimateFps,
    bulkAnimateLoop,
    fetchImages,
    namespace,
    selectedCount,
    selectedImageIds,
    setBulkAnimateFilename,
    setBulkAnimateFps,
    setBulkAnimateLoop,
    setBulkAnimateTouched,
    setBulkEditOpen,
    setBulkAnimateError,
    setBulkAnimateLoading,
    toastPush
  ]);

  const deleteSelectedImages = useCallback(async () => {
    if (!selectedCount) {
      toastPush('Select images to delete');
      return;
    }
    const confirmed =
      typeof window === 'undefined'
        ? true
        : window.confirm(
            `Delete ${selectedCount} image${selectedCount === 1 ? '' : 's'}? This cannot be undone.`
          );
    if (!confirmed) {
      return;
    }
    setBulkDeleting(true);
    try {
      const ids = Array.from(selectedImageIds);
      const settled = await Promise.allSettled(
        ids.map(async (id) => {
          const response = await fetch(`/api/images/${id}`, {
            method: 'DELETE'
          });
          if (!response.ok) {
            let message = `HTTP ${response.status}`;
            try {
              const payload = await response.json();
              if (typeof payload?.error === 'string' && payload.error.trim()) {
                message = payload.error;
              }
            } catch {
              // ignore JSON parse failure and keep HTTP status message
            }
            throw new Error(message);
          }
          return id;
        })
      );

      const deletedIds = settled
        .filter((result): result is PromiseFulfilledResult<string> => result.status === 'fulfilled')
        .map(result => result.value);
      const failedCount = settled.length - deletedIds.length;

      if (deletedIds.length > 0) {
        const deletedSet = new Set(deletedIds);
        setImages(prev => prev.filter(img => !deletedSet.has(img.id)));
      }

      if (failedCount === 0) {
        toastPush(`Deleted ${deletedIds.length} image${deletedIds.length === 1 ? '' : 's'}`);
        clearSelection();
        setBulkSelectionMode(false);
      } else if (deletedIds.length > 0) {
        toastPush(`Deleted ${deletedIds.length}, failed ${failedCount}`);
      } else {
        toastPush('Bulk delete failed');
      }
    } catch (error) {
      console.error('Bulk delete failed', error);
      toastPush('Bulk delete failed');
    } finally {
      setBulkDeleting(false);
    }
  }, [
    clearSelection,
    selectedCount,
    selectedImageIds,
    setBulkDeleting,
    setBulkSelectionMode,
    setImages,
    toastPush
  ]);

  const generateEmbeddingsForSelected = useCallback(async () => {
    if (!selectedCount) {
      toastPush('Select images to generate embeddings');
      return;
    }
    
    setBulkEmbeddingGenerating(true);
    try {
      const imageIds = Array.from(selectedImageIds);
      const response = await fetch('/api/images/embeddings/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageIds }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to generate embeddings');
      }
      
      const result = await response.json();
      
      setImages(prev => prev.map(img => {
        if (selectedImageIds.has(img.id)) {
          const imgResult = result.results?.find((r: { imageId: string }) => r.imageId === img.id);
          if (imgResult?.success && !imgResult?.skipped) {
            return {
              ...img,
              hasClipEmbedding: imgResult.clipGenerated || img.hasClipEmbedding,
              hasColorEmbedding: imgResult.colorGenerated || img.hasColorEmbedding,
            };
          }
        }
        return img;
      }));
      
      toastPush(`Generated embeddings: ${result.success} success, ${result.skipped} skipped, ${result.errors} errors`);
    } catch (error) {
      console.error('Batch embedding generation failed', error);
      toastPush(error instanceof Error ? error.message : 'Embedding generation failed');
    } finally {
      setBulkEmbeddingGenerating(false);
    }
  }, [
    selectedCount,
    selectedImageIds,
    setBulkEmbeddingGenerating,
    setImages,
    toastPush
  ]);

  return {
    applyBulkUpdates,
    createBulkAnimation,
    deleteSelectedImages,
    generateEmbeddingsForSelected,
  };
};
