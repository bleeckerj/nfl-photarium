import { useCallback } from 'react';
import type { CloudflareImage } from '../types';
import { truncateMiddle } from '@/components/gallery/utils';
import { requestSemanticTags } from '@/services/imageAltDescriptionService';
import { deleteImage as requestDeleteImage } from '@/services/imageDeletionService';
import { mergeUserTagsPreservingSystemTags } from '@/utils/systemTags';
import { applyEmbeddingResultToImage } from '../embeddingResult';

const BULK_UPDATE_CONCURRENCY = 4;

const runWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<Array<PromiseSettledResult<R>>> => {
  const results: Array<PromiseSettledResult<R>> = new Array(items.length);
  let cursor = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) {
          break;
        }
        try {
          results[index] = {
            status: 'fulfilled',
            value: await worker(items[index], index),
          };
        } catch (reason) {
          results[index] = {
            status: 'rejected',
            reason,
          };
        }
      }
    })
  );

  return results;
};

type BulkUpdateResult = {
  id: string;
  ok: boolean;
  skipped?: boolean;
};

const resolveGalleryNamespaceScope = (namespace?: string): string | null => {
  const trimmed = namespace?.trim();
  if (trimmed === '__all__') return null;
  return trimmed || process.env.NEXT_PUBLIC_IMAGE_NAMESPACE || 'cf-default';
};

export const resolveBulkAnimationIds = (
  images: Pick<CloudflareImage, 'id'>[],
  selectedImageIds: Set<string>,
  orderMode: 'gallery' | 'reverse-gallery',
  additionalImages: Pick<CloudflareImage, 'id'>[] = [],
) => {
  const seenIds = new Set<string>();
  const selectedIds = [...images, ...additionalImages]
    .filter((image) => selectedImageIds.has(image.id))
    .map((image) => image.id)
    .filter((id) => {
      if (seenIds.has(id)) return false;
      seenIds.add(id);
      return true;
    });
  return orderMode === 'reverse-gallery' ? [...selectedIds].reverse() : selectedIds;
};

interface UseGalleryBulkActionsOptions {
  images: CloudflareImage[];
  selectedImages: CloudflareImage[];
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
  setBulkAnimateOrderMode: (value: 'gallery' | 'reverse-gallery') => void;
  setBulkAnimateNamespaceInput: (value: string) => void;
  setBulkAnimateTouched: (value: boolean) => void;
  bulkApplyFolder: boolean;
  bulkApplyTags: boolean;
  bulkFolderInput: string;
  bulkTagsInput: string;
  bulkTagsMode: 'replace' | 'append' | 'ai';
  bulkTagsAiCount: string;
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
  bulkAnimateOrderMode: 'gallery' | 'reverse-gallery';
  bulkAnimateNamespaceInput: string;
  namespace?: string;
  fetchImages: (options?: { silent?: boolean; forceRefresh?: boolean }) => Promise<void>;
}

export const useGalleryBulkActions = ({
  images,
  selectedImages,
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
  setBulkAnimateOrderMode,
  setBulkAnimateNamespaceInput,
  setBulkAnimateTouched,
  bulkApplyFolder,
  bulkApplyTags,
  bulkFolderInput,
  bulkTagsInput,
  bulkTagsMode,
  bulkTagsAiCount,
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
  bulkAnimateOrderMode,
  bulkAnimateNamespaceInput,
  namespace,
  fetchImages,
}: UseGalleryBulkActionsOptions) => {
  const mergeUniqueTags = useCallback((existingTags: string[], incomingTags: string[]) => {
    const merged = new Map<string, string>();
    existingTags.forEach((tag) => {
      const trimmed = tag.trim();
      if (!trimmed) return;
      merged.set(trimmed.toLowerCase(), trimmed);
    });
    incomingTags.forEach((tag) => {
      const trimmed = tag.trim();
      if (!trimmed) return;
      if (!merged.has(trimmed.toLowerCase())) {
        merged.set(trimmed.toLowerCase(), trimmed);
      }
    });
    return Array.from(merged.values());
  }, []);

  const applyBulkUpdates = useCallback(async (options?: { namespaceOverride?: string }) => {
    if (!selectedCount) {
      toastPush('No images selected');
      return;
    }
    const parsedBulkTags = bulkTagsInput
      .split(',')
      .map(tag => tag.trim())
      .filter(Boolean)
      .filter(tag => !tag.startsWith('_'));
    const aiTagCount = Math.min(12, Math.max(1, Number.parseInt(bulkTagsAiCount, 10) || 6));
    const hasTagChanges =
      bulkApplyTags &&
      (bulkTagsMode === 'replace' || bulkTagsMode === 'ai' || parsedBulkTags.length > 0);
    const hasDisplayNameChanges = bulkApplyDisplayName;
    const descriptionAppendText = bulkDescriptionAppendInput.trim();
    const hasDescriptionChanges = bulkApplyDescription && descriptionAppendText.length > 0;
    const effectiveBulkNamespace = (options?.namespaceOverride ?? bulkNamespaceInput).trim();
    const hasNamespaceChanges = bulkApplyNamespace;
    if (!bulkApplyFolder && !hasTagChanges && !hasDisplayNameChanges && !hasDescriptionChanges && !hasNamespaceChanges) {
      toastPush('Choose at least one field to update');
      return;
    }
    if (hasNamespaceChanges && !effectiveBulkNamespace) {
      toastPush('Choose a namespace to move selected images');
      return;
    }
    setBulkUpdating(true);
    try {
      const wantsAiDisplayName = bulkApplyDisplayName && bulkDisplayNameMode === 'ai';
      const wantsAiTags = bulkApplyTags && bulkTagsMode === 'ai';
      const generatedDisplayNames = new Map<string, string>();
      const generatedTags = new Map<string, string[]>();
      let aiSuccessCount = 0;
      let aiFailureCount = 0;
      let aiTagSuccessCount = 0;
      let aiTagFailureCount = 0;
      let aiTagNoopCount = 0;
      const imageById = new Map([
        ...selectedImages.map((image) => [image.id, image] as const),
        ...images.map((image) => [image.id, image] as const),
      ]);
      const selectedIds = Array.from(selectedImageIds);
      const settled = await runWithConcurrency<string, BulkUpdateResult>(
        selectedIds,
        BULK_UPDATE_CONCURRENCY,
        async id => {
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
              const target = imageById.get(id);
              payload.tags = mergeUserTagsPreservingSystemTags(target?.tags, parsedBulkTags);
            } else if (bulkTagsMode === 'ai') {
              const target = imageById.get(id);
              if (target?.assetType === 'video') {
                aiTagFailureCount += 1;
              } else {
                try {
                  const { ok, payload: tagPayload } = await requestSemanticTags(id, aiTagCount);
                  const suggestedTags = Array.isArray(tagPayload?.tags)
                    ? tagPayload.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
                    : [];
                  if (!ok) {
                    aiTagFailureCount += 1;
                  } else if (suggestedTags.length === 0) {
                    aiTagNoopCount += 1;
                  } else {
                    const existingTags = Array.isArray(target?.tags) ? target.tags : [];
                    const mergedTags = mergeUniqueTags(existingTags, suggestedTags);
                    if (mergedTags.length === existingTags.length) {
                      aiTagNoopCount += 1;
                    } else {
                      payload.tags = mergedTags;
                      generatedTags.set(id, mergedTags);
                      aiTagSuccessCount += 1;
                    }
                  }
                } catch (error) {
                  console.error('Failed to generate semantic tags', error);
                  aiTagFailureCount += 1;
                }
              }
            } else if (parsedBulkTags.length > 0) {
              const target = imageById.get(id);
              const existingTags = Array.isArray(target?.tags) ? target.tags : [];
              payload.tags = mergeUniqueTags(existingTags, parsedBulkTags);
            }
          }
          if (bulkApplyDisplayName) {
            if (bulkDisplayNameMode === 'clear') {
              payload.displayName = '';
            } else if (bulkDisplayNameMode === 'custom') {
              payload.displayName = bulkDisplayNameInput.trim();
            } else if (bulkDisplayNameMode === 'auto') {
              const target = imageById.get(id);
              const baseName = target?.filename || '';
              payload.displayName = truncateMiddle(baseName, 64);
            } else if (bulkDisplayNameMode === 'ai') {
              try {
                const target = imageById.get(id);
                if (target?.assetType === 'video') {
                  aiFailureCount += 1;
                  return { id, ok: true, skipped: true };
                }
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
            const target = imageById.get(id);
            const currentDescription = (target?.description || '').trim();
            payload.description = currentDescription
              ? `${currentDescription}\n\n${descriptionAppendText}`
              : descriptionAppendText;
          }
          if (bulkApplyNamespace) {
            payload.namespace = effectiveBulkNamespace;
          }
          if (!Object.keys(payload).length) {
            return { id, ok: true, skipped: true };
          }
          const target = imageById.get(id);
          const updateEndpoint = target?.assetType === 'video'
            ? `/api/videos/${id}/update`
            : `/api/images/${id}/update`;
          const response = await fetch(updateEndpoint, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          return { id, ok: response.ok };
        }
      );
      const successfulIds = new Set<string>();
      let failedCount = 0;
      let effectiveTaskCount = 0;
      for (const result of settled) {
        if (result.status === 'rejected') {
          failedCount += 1;
          continue;
        }
        if (result.value.skipped) {
          continue;
        }
        effectiveTaskCount += 1;
        if (!result.value.ok) {
          failedCount += 1;
          continue;
        }
        successfulIds.add(result.value.id);
      }
      if (effectiveTaskCount > 0 && successfulIds.size === 0) {
        toastPush('Bulk update failed');
        return;
      }
      const activeNamespaceScope = resolveGalleryNamespaceScope(namespace);
      const movedOutOfCurrentNamespace =
        bulkApplyNamespace &&
        activeNamespaceScope !== null &&
        effectiveBulkNamespace !== activeNamespaceScope;
      setImages(prev => {
        const updatedImages = prev.map(img => {
          if (!selectedImageIds.has(img.id)) {
            return img;
          }
          if (effectiveTaskCount > 0 && !successfulIds.has(img.id)) {
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
              updatedTags = mergeUserTagsPreservingSystemTags(img.tags, parsedBulkTags);
            } else if (bulkTagsMode === 'ai') {
              updatedTags = generatedTags.get(img.id) ?? updatedTags;
            } else if (parsedBulkTags.length > 0) {
              updatedTags = mergeUniqueTags(img.tags ?? [], parsedBulkTags);
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
          const updatedNamespace = bulkApplyNamespace ? effectiveBulkNamespace : img.namespace;

          return {
            ...img,
            folder: bulkApplyFolder ? updatedFolder : img.folder,
            tags: updatedTags,
            displayName: updatedDisplayName,
            description: updatedDescription,
            namespace: updatedNamespace
          };
        });
        return movedOutOfCurrentNamespace
          ? updatedImages.filter(img => !successfulIds.has(img.id))
          : updatedImages;
      });
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
      if (wantsAiTags) {
        const total = selectedImageIds.size;
        if (aiTagSuccessCount === 0 && aiTagFailureCount === 0) {
          toastPush('No new tags generated');
        } else if (aiTagSuccessCount === 0) {
          toastPush('No new tags generated');
        } else if (aiTagFailureCount > 0 || aiTagNoopCount > 0) {
          toastPush(`Generated tags for ${aiTagSuccessCount}/${total} images`);
        } else {
          toastPush('AI tags generated');
        }
      }
      if (failedCount > 0) {
        toastPush(`Updated ${successfulIds.size}, failed ${failedCount}`);
      } else {
        toastPush('Images updated');
      }
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
    bulkTagsAiCount,
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
    namespace,
    selectedCount,
    selectedImages,
    selectedImageIds,
    setBulkEditOpen,
    setBulkSelectionMode,
    setBulkUpdating,
    setImages,
    toastPush,
    mergeUniqueTags
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
      const orderedIds = resolveBulkAnimationIds(images, selectedImageIds, bulkAnimateOrderMode, selectedImages);
      const response = await fetch('/api/animate/selection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: orderedIds,
          fps: fpsValue,
          loop: bulkAnimateLoop,
          filename: bulkAnimateFilename.trim() || undefined,
          orderMode: bulkAnimateOrderMode,
          namespace: bulkAnimateNamespaceInput.trim() || namespace
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
      setBulkAnimateOrderMode('gallery');
      setBulkAnimateNamespaceInput('');
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
    bulkAnimateNamespaceInput,
    bulkAnimateOrderMode,
    fetchImages,
    images,
    namespace,
    selectedCount,
    selectedImageIds,
    selectedImages,
    setBulkAnimateFilename,
    setBulkAnimateFps,
    setBulkAnimateLoop,
    setBulkAnimateNamespaceInput,
    setBulkAnimateOrderMode,
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
          await requestDeleteImage(id);
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
            return applyEmbeddingResultToImage(img, imgResult);
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
