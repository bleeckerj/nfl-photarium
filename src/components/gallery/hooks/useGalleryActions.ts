/**
 * useGalleryActions Hook
 * 
 * Handles image operations: delete, edit, generate ALT, etc.
 */

'use client';

import { useState, useCallback } from 'react';
import type { CloudflareImage } from '../types';
import { truncateMiddle } from '../utils';
import { setEmbeddingPendingEntry } from '@/utils/embeddingPending';
import { requestSemanticTags } from '@/services/imageAltDescriptionService';

interface UseGalleryActionsOptions {
  images: CloudflareImage[];
  setImages: React.Dispatch<React.SetStateAction<CloudflareImage[]>>;
  selectedImageIds: Set<string>;
  clearSelection: () => void;
  setBulkSelectionMode: (value: boolean) => void;
  fetchImages: (options?: { silent?: boolean; forceRefresh?: boolean }) => Promise<void>;
  namespace?: string;
  toast: { push: (message: string) => void };
}

interface UseGalleryActionsReturn {
  // Single image actions
  deleteImage: (imageId: string) => Promise<void>;
  generateAltTag: (imageId: string) => Promise<void>;
  altLoadingMap: Record<string, boolean>;
  generateDisplayName: (imageId: string) => Promise<void>;
  displayNameLoadingMap: Record<string, boolean>;
  
  // Edit modal state
  editingImage: string | null;
  editTags: string;
  setEditTags: (tags: string) => void;
  editFolderSelect: string;
  setEditFolderSelect: (folder: string) => void;
  newEditFolder: string;
  setNewEditFolder: (folder: string) => void;
  startEdit: (image: CloudflareImage) => void;
  cancelEdit: () => void;
  saveEdit: (imageId: string) => Promise<void>;
  
  // Bulk actions
  bulkUpdating: boolean;
  bulkDeleting: boolean;
  bulkEmbeddingGenerating: boolean;
  applyBulkUpdates: (options: BulkUpdateOptions) => Promise<void>;
  deleteSelectedImages: () => Promise<void>;
  generateEmbeddingsForSelected: () => Promise<void>;
  refreshEmbeddingsForSelected: () => Promise<void>;
  queueEmbeddingsForSelected: () => Promise<void>;
  
  // Animation
  bulkAnimateLoading: boolean;
  bulkAnimateError: string | null;
  setBulkAnimateError: (error: string | null) => void;
  createBulkAnimation: (options: AnimationOptions) => Promise<void>;
}

interface BulkUpdateOptions {
  applyFolder: boolean;
  folderMode: 'existing' | 'new';
  folderInput: string;
  applyTags: boolean;
  tagsMode: 'replace' | 'append' | 'ai';
  tagsInput: string;
  tagsAiCount: number;
  applyDisplayName: boolean;
  displayNameMode: 'custom' | 'auto' | 'clear' | 'ai';
  displayNameInput: string;
  applyNamespace: boolean;
  namespaceInput: string;
}

const mergeUniqueTags = (existingTags: string[], incomingTags: string[]) => {
  const merged = new Map<string, string>();
  existingTags.forEach((tag) => {
    const normalized = tag.trim().toLowerCase();
    if (normalized) {
      merged.set(normalized, tag.trim());
    }
  });
  incomingTags.forEach((tag) => {
    const trimmed = tag.trim();
    const normalized = trimmed.toLowerCase();
    if (normalized && !merged.has(normalized)) {
      merged.set(normalized, trimmed);
    }
  });
  return Array.from(merged.values());
};

interface AnimationOptions {
  fps: string;
  loop: boolean;
  filename: string;
}

export function useGalleryActions({
  images,
  setImages,
  selectedImageIds,
  clearSelection,
  setBulkSelectionMode,
  fetchImages,
  namespace,
  toast,
}: UseGalleryActionsOptions): UseGalleryActionsReturn {
  // ALT generation loading state
  const [altLoadingMap, setAltLoadingMap] = useState<Record<string, boolean>>({});
  const [displayNameLoadingMap, setDisplayNameLoadingMap] = useState<Record<string, boolean>>({});
  
  // Edit modal state
  const [editingImage, setEditingImage] = useState<string | null>(null);
  const [editTags, setEditTags] = useState<string>('');
  const [editFolderSelect, setEditFolderSelect] = useState<string>('');
  const [newEditFolder, setNewEditFolder] = useState<string>('');
  
  // Bulk operation states
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkEmbeddingGenerating, setBulkEmbeddingGenerating] = useState(false);
  const [bulkAnimateLoading, setBulkAnimateLoading] = useState(false);
  const [bulkAnimateError, setBulkAnimateError] = useState<string | null>(null);

  // Delete single image
  const deleteImage = useCallback(async (imageId: string) => {
    try {
      const response = await fetch(`/api/images/${imageId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setImages(prev => prev.filter(img => img.id !== imageId));
      }
    } catch (error) {
      console.error('Failed to delete image:', error);
    }
  }, [setImages]);

  // Generate ALT tag
  const generateAltTag = useCallback(async (imageId: string) => {
    setAltLoadingMap(prev => ({ ...prev, [imageId]: true }));
    try {
      const response = await fetch(`/api/images/${imageId}/alt`, {
        method: 'POST',
      });
      const data = await response.json();

      if (!response.ok) {
        const message = typeof data?.error === 'string' ? data.error : 'Failed to generate ALT text';
        toast.push(message);
        return;
      }

      if (!data?.altTag) {
        toast.push('ALT text response was empty');
        return;
      }

      setImages(prev => prev.map(img =>
        img.id === imageId ? { ...img, altTag: data.altTag } : img
      ));
      toast.push('ALT text updated');
    } catch (error) {
      console.error('Failed to generate ALT text:', error);
      toast.push('Failed to generate ALT text');
    } finally {
      setAltLoadingMap(prev => {
        const next = { ...prev };
        delete next[imageId];
        return next;
      });
    }
  }, [setImages, toast]);

  const generateDisplayName = useCallback(async (imageId: string) => {
    setDisplayNameLoadingMap(prev => ({ ...prev, [imageId]: true }));
    try {
      const response = await fetch(`/api/images/${imageId}/display-name`, {
        method: 'POST',
      });
      const data = await response.json();

      if (!response.ok) {
        const message = typeof data?.error === 'string' ? data.error : 'Failed to generate display name';
        toast.push(message);
        return;
      }

      if (!data?.displayName) {
        toast.push('Display name response was empty');
        return;
      }

      const saveResponse = await fetch(`/api/images/${imageId}/update`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: data.displayName }),
      });
      if (!saveResponse.ok) {
        const savePayload = await saveResponse.json().catch(() => ({}));
        const message = typeof savePayload?.error === 'string'
          ? savePayload.error
          : 'Failed to save display name';
        toast.push(message);
        return;
      }

      setImages(prev => prev.map(img =>
        img.id === imageId ? { ...img, displayName: data.displayName } : img
      ));
      toast.push('Display name updated');
    } catch (error) {
      console.error('Failed to generate display name:', error);
      toast.push('Failed to generate display name');
    } finally {
      setDisplayNameLoadingMap(prev => {
        const next = { ...prev };
        delete next[imageId];
        return next;
      });
    }
  }, [setImages, toast]);

  // Edit modal operations
  const startEdit = useCallback((image: CloudflareImage) => {
    setEditingImage(image.id);
    setEditFolderSelect(image.folder || '');
    setNewEditFolder('');
    setEditTags(image.tags ? image.tags.join(', ') : '');
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingImage(null);
    setEditFolderSelect('');
    setNewEditFolder('');
    setEditTags('');
  }, []);

  const saveEdit = useCallback(async (imageId: string) => {
    try {
      const finalFolder = editFolderSelect === '__create__'
        ? newEditFolder.trim()
        : editFolderSelect;
      const target = images.find(img => img.id === imageId);
      const folderChanged = (target?.folder ?? '') !== (finalFolder ?? '');
      const tagsPayload = editTags.trim()
        ? editTags.split(',').map(t => t.trim()).filter(Boolean)
        : [];
      const payload: Record<string, unknown> = { tags: tagsPayload };
      if (folderChanged) {
        payload.folder = finalFolder;
        payload.applyToFamily = true;
        payload.applyToFamilyFields = ['folder'];
      }

      const response = await fetch(`/api/images/${imageId}/update`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...payload,
        }),
      });

      if (response.ok) {
        const familyRoot = target?.parentId || imageId;
        const familyIds = new Set<string>();
        images.forEach(img => {
          if (img.id === familyRoot || img.parentId === familyRoot) {
            familyIds.add(img.id);
          }
        });
        familyIds.add(familyRoot);

        setImages(prev => prev.map(img => {
          const inFamily = folderChanged && familyIds.has(img.id);
          const isTarget = img.id === imageId;
          if (!inFamily && !isTarget) return img;

          return {
            ...img,
            folder: inFamily ? (finalFolder || undefined) : img.folder,
            tags: isTarget ? tagsPayload : img.tags,
          };
        }));
        cancelEdit();
      } else {
        alert('Failed to update image metadata');
      }
    } catch (error) {
      console.error('Failed to update image:', error);
      alert('Failed to update image metadata');
    }
  }, [editFolderSelect, editTags, newEditFolder, setImages, cancelEdit, images]);

  // Bulk update
  const applyBulkUpdates = useCallback(async (options: BulkUpdateOptions) => {
    const selectedCount = selectedImageIds.size;
    if (!selectedCount) {
      toast.push('No images selected');
      return;
    }

    const parsedBulkTags = options.tagsInput
      .split(',')
      .map(tag => tag.trim())
      .filter(Boolean);

    const hasTagChanges =
      options.applyTags &&
      (options.tagsMode === 'replace' || options.tagsMode === 'ai' || parsedBulkTags.length > 0);
    const hasDisplayNameChanges = options.applyDisplayName;
    const hasNamespaceChanges = options.applyNamespace;

    if (!options.applyFolder && !hasTagChanges && !hasDisplayNameChanges && !hasNamespaceChanges) {
      toast.push('Choose at least one field to update');
      return;
    }

    setBulkUpdating(true);
    try {
      const wantsAiDisplayName = options.applyDisplayName && options.displayNameMode === 'ai';
      const wantsAiTags = options.applyTags && options.tagsMode === 'ai';
      const generatedDisplayNames = new Map<string, string>();
      const generatedTags = new Map<string, string[]>();
      let aiSuccessCount = 0;
      let aiFailureCount = 0;
      let aiTagSuccessCount = 0;
      let aiTagFailureCount = 0;
      const familyFields: string[] = [];
      if (options.applyFolder) familyFields.push('folder');
      if (options.applyNamespace) familyFields.push('namespace');
      const hasFamilyUpdates = familyFields.length > 0;
      const hasPerImageChanges = hasTagChanges || hasDisplayNameChanges;
      const imageById = new Map(images.map(img => [img.id, img]));

      const familyTargets = new Map<string, string>();
      const familyMemberIds = new Set<string>();

      if (hasFamilyUpdates) {
        selectedImageIds.forEach(id => {
          const img = imageById.get(id);
          const rootId = img?.parentId || id;
          if (!familyTargets.has(rootId)) {
            familyTargets.set(rootId, id);
          }
        });

        images.forEach(img => {
          const rootId = img.parentId || img.id;
          if (familyTargets.has(rootId)) {
            familyMemberIds.add(img.id);
          }
        });
      }

      const requests: Promise<Response>[] = [];
      const folderValue = options.applyFolder
        ? (options.folderMode === 'existing' ? options.folderInput : options.folderInput.trim())
        : undefined;
      const namespaceValue = options.applyNamespace ? options.namespaceInput.trim() : undefined;

      if (hasFamilyUpdates) {
        const familyPayload: Record<string, unknown> = {
          applyToFamily: true,
          applyToFamilyFields: familyFields,
        };

        if (options.applyFolder) {
          familyPayload.folder = folderValue ?? '';
        }
        if (options.applyNamespace) {
          familyPayload.namespace = namespaceValue ?? '';
        }

        for (const id of familyTargets.values()) {
          requests.push(
            fetch(`/api/images/${id}/update`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(familyPayload),
            })
          );
        }
      }

      const perImageRequests = hasPerImageChanges
        ? Array.from(selectedImageIds).map(async id => {
            const payload: Record<string, unknown> = {};

            if (options.applyTags) {
              if (options.tagsMode === 'replace') {
                payload.tags = options.tagsInput;
              } else if (options.tagsMode === 'ai') {
                try {
                  const target = imageById.get(id);
                  const remoteUrl = target?.variants?.[0];
                  if (!remoteUrl) {
                    aiTagFailureCount += 1;
                  } else {
                    const { ok, payload: tagPayload } = await requestSemanticTags(id, options.tagsAiCount);
                    const suggestedTags = Array.isArray(tagPayload?.tags)
                      ? tagPayload.tags.filter((tag: unknown): tag is string => typeof tag === 'string' && tag.trim().length > 0)
                      : [];
                    if (ok && suggestedTags.length > 0) {
                      const existingTags = Array.isArray(target?.tags) ? target.tags : [];
                      const mergedTags = mergeUniqueTags(existingTags, suggestedTags);
                      payload.tags = mergedTags;
                      generatedTags.set(id, mergedTags);
                      aiTagSuccessCount += 1;
                    } else {
                      aiTagFailureCount += 1;
                    }
                  }
                } catch (error) {
                  console.error('Failed to generate tags', error);
                  aiTagFailureCount += 1;
                }
              } else if (parsedBulkTags.length > 0) {
                const target = imageById.get(id);
                const existingTags = Array.isArray(target?.tags) ? target.tags : [];
                const merged = new Map<string, string>();
                existingTags.forEach(tag => merged.set(tag.toLowerCase(), tag));
                parsedBulkTags.forEach(tag => merged.set(tag.toLowerCase(), tag));
                payload.tags = Array.from(merged.values());
              }
            }

            if (options.applyDisplayName) {
              if (options.displayNameMode === 'clear') {
                payload.displayName = '';
              } else if (options.displayNameMode === 'custom') {
                payload.displayName = options.displayNameInput.trim();
              } else if (options.displayNameMode === 'auto') {
                const target = imageById.get(id);
                const baseName = target?.filename || '';
                payload.displayName = truncateMiddle(baseName, 64);
              } else if (options.displayNameMode === 'ai') {
                try {
                  const displayNameResponse = await fetch(`/api/images/${id}/display-name`, { method: 'POST' });
                  const displayNamePayload = await displayNameResponse.json();
                  if (displayNameResponse.ok && displayNamePayload?.displayName) {
                    payload.displayName = displayNamePayload.displayName;
                    generatedDisplayNames.set(id, displayNamePayload.displayName);
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

            if (Object.keys(payload).length === 0) {
              return null;
            }

            return fetch(`/api/images/${id}/update`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
          })
        : [];

      await Promise.all([...requests, ...perImageRequests]);

      // Update local state
      setImages(prev =>
        prev.map(img => {
          const inFamily = hasFamilyUpdates && familyMemberIds.has(img.id);
          const isSelected = selectedImageIds.has(img.id);
          if (!inFamily && !isSelected) return img;

          let updatedFolder: string | undefined = img.folder;
          if (options.applyFolder && inFamily) {
            updatedFolder = folderValue || undefined;
          }

          let updatedTags = img.tags;
          if (options.applyTags && isSelected) {
            if (options.tagsMode === 'replace') {
              updatedTags = parsedBulkTags;
            } else if (options.tagsMode === 'ai') {
              const aiTags = generatedTags.get(img.id);
              if (aiTags) {
                updatedTags = aiTags;
              }
            } else if (parsedBulkTags.length > 0) {
              const merged = new Map<string, string>();
              (img.tags ?? []).forEach(tag => merged.set(tag.toLowerCase(), tag));
              parsedBulkTags.forEach(tag => merged.set(tag.toLowerCase(), tag));
              updatedTags = Array.from(merged.values());
            }
          }

          let updatedDisplayName = img.displayName;
          if (options.applyDisplayName && isSelected) {
            if (options.displayNameMode === 'clear') {
              updatedDisplayName = '';
            } else if (options.displayNameMode === 'custom') {
              updatedDisplayName = options.displayNameInput.trim();
            } else if (options.displayNameMode === 'auto') {
              updatedDisplayName = truncateMiddle(img.filename || '', 64);
            } else if (options.displayNameMode === 'ai') {
              const generated = generatedDisplayNames.get(img.id);
              updatedDisplayName = generated ?? updatedDisplayName;
            }
          }

          const updatedNamespace = options.applyNamespace && inFamily
            ? (namespaceValue || undefined)
            : img.namespace;

          return {
            ...img,
            folder: updatedFolder,
            tags: updatedTags,
            displayName: updatedDisplayName,
            namespace: updatedNamespace,
          };
        })
      );

      if (wantsAiDisplayName) {
        const total = selectedImageIds.size;
        if (aiSuccessCount === 0) {
          toast.push('No display names generated');
        } else if (aiSuccessCount < total || aiFailureCount > 0) {
          toast.push(`Generated display names for ${aiSuccessCount}/${total} images`);
        } else {
          toast.push('Display names generated');
        }
      }
      if (wantsAiTags) {
        const total = selectedImageIds.size;
        if (aiTagSuccessCount === 0) {
          toast.push('No tags generated');
        } else if (aiTagSuccessCount < total || aiTagFailureCount > 0) {
          toast.push(`Generated tags for ${aiTagSuccessCount}/${total} images`);
        } else {
          toast.push('AI tags generated');
        }
      }
      toast.push('Images updated');
      clearSelection();
      setBulkSelectionMode(false);
    } catch (error) {
      console.error('Bulk update failed', error);
      toast.push('Bulk update failed');
    } finally {
      setBulkUpdating(false);
    }
  }, [images, selectedImageIds, setImages, toast, clearSelection, setBulkSelectionMode]);

  // Delete selected images
  const deleteSelectedImages = useCallback(async () => {
    const selectedCount = selectedImageIds.size;
    if (!selectedCount) {
      toast.push('Select images to delete');
      return;
    }

    const confirmed =
      typeof window === 'undefined'
        ? true
        : window.confirm(
            `Delete ${selectedCount} image${selectedCount === 1 ? '' : 's'}? This cannot be undone.`
          );
    if (!confirmed) return;

    setBulkDeleting(true);
    try {
      await Promise.all(
        Array.from(selectedImageIds).map(id =>
          fetch(`/api/images/${id}`, { method: 'DELETE' })
        )
      );
      setImages(prev => prev.filter(img => !selectedImageIds.has(img.id)));
      toast.push('Images deleted');
      clearSelection();
      setBulkSelectionMode(false);
    } catch (error) {
      console.error('Bulk delete failed', error);
      toast.push('Bulk delete failed');
    } finally {
      setBulkDeleting(false);
    }
  }, [selectedImageIds, setImages, toast, clearSelection, setBulkSelectionMode]);

  // Generate embeddings for selected
  const runBatchEmbeddingsForSelected = useCallback(async ({ force }: { force: boolean }) => {
    const selectedCount = selectedImageIds.size;
    if (!selectedCount) {
      toast.push('Select images to generate embeddings');
      return;
    }

    setBulkEmbeddingGenerating(true);
    try {
      const imageIds = Array.from(selectedImageIds);
      for (const imageId of imageIds) {
        setEmbeddingPendingEntry(imageId, {
          status: 'embedding',
          clip: true,
          color: true,
          updatedAt: new Date().toISOString(),
        });
      }
      const response = await fetch('/api/images/embeddings/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageIds, force }),
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
            setEmbeddingPendingEntry(img.id, undefined);
            return {
              ...img,
              hasClipEmbedding: imgResult.clipGenerated || img.hasClipEmbedding,
              hasColorEmbedding: imgResult.colorGenerated || img.hasColorEmbedding,
            };
          }
          if (imgResult?.success && imgResult?.skipped) {
            setEmbeddingPendingEntry(img.id, undefined);
          } else if (imgResult && !imgResult.success) {
            setEmbeddingPendingEntry(img.id, {
              status: 'error',
              clip: true,
              color: true,
              error: typeof imgResult.error === 'string' ? imgResult.error : 'Embedding failed',
              updatedAt: new Date().toISOString(),
            });
          }
        }
        return img;
      }));

      toast.push(
        force
          ? `Refreshed embeddings: ${result.success} success, ${result.skipped} skipped, ${result.errors} errors`
          : `Generated embeddings: ${result.success} success, ${result.skipped} skipped, ${result.errors} errors`
      );
    } catch (error) {
      console.error('Batch embedding generation failed', error);
      for (const imageId of selectedImageIds) {
        setEmbeddingPendingEntry(imageId, {
          status: 'error',
          clip: true,
          color: true,
          error: error instanceof Error ? error.message : 'Embedding generation failed',
          updatedAt: new Date().toISOString(),
        });
      }
      toast.push(error instanceof Error ? error.message : 'Embedding generation failed');
    } finally {
      setBulkEmbeddingGenerating(false);
    }
  }, [selectedImageIds, setImages, toast]);

  const generateEmbeddingsForSelected = useCallback(async () => {
    await runBatchEmbeddingsForSelected({ force: false });
  }, [runBatchEmbeddingsForSelected]);

  const refreshEmbeddingsForSelected = useCallback(async () => {
    await runBatchEmbeddingsForSelected({ force: true });
  }, [runBatchEmbeddingsForSelected]);

  const queueEmbeddingsForSelected = useCallback(async () => {
    const selectedCount = selectedImageIds.size;
    if (!selectedCount) {
      toast.push('Select images to queue embeddings');
      return;
    }

    const imageIds = Array.from(selectedImageIds);
    for (const imageId of imageIds) {
      setEmbeddingPendingEntry(imageId, {
        status: 'queued',
        clip: true,
        color: true,
        updatedAt: new Date().toISOString(),
      });
    }
    toast.push(`Queued ${imageIds.length} images for embedding generation`);

    void (async () => {
      const chunkSize = 20;
      for (let index = 0; index < imageIds.length; index += chunkSize) {
        const chunk = imageIds.slice(index, index + chunkSize);
        try {
          chunk.forEach((imageId) => {
            setEmbeddingPendingEntry(imageId, {
              status: 'embedding',
              clip: true,
              color: true,
              updatedAt: new Date().toISOString(),
            });
          });
          const response = await fetch('/api/images/embeddings/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageIds: chunk, force: false }),
          });
          const result = await response.json();
          if (!response.ok) {
            throw new Error(result.error || 'Failed to process embedding queue chunk');
          }
          setImages((prev) =>
            prev.map((img) => {
              const item = result.results?.find((r: { imageId: string }) => r.imageId === img.id);
              if (!item) return img;
              if (item.success) {
                setEmbeddingPendingEntry(img.id, undefined);
                return {
                  ...img,
                  hasClipEmbedding: item.clipGenerated || img.hasClipEmbedding,
                  hasColorEmbedding: item.colorGenerated || img.hasColorEmbedding,
                };
              }
              setEmbeddingPendingEntry(img.id, {
                status: 'error',
                clip: true,
                color: true,
                error: typeof item.error === 'string' ? item.error : 'Embedding failed',
                updatedAt: new Date().toISOString(),
              });
              return img;
            })
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Embedding queue failed';
          chunk.forEach((imageId) => {
            setEmbeddingPendingEntry(imageId, {
              status: 'error',
              clip: true,
              color: true,
              error: message,
              updatedAt: new Date().toISOString(),
            });
          });
        }
      }
      await fetchImages({ silent: true });
    })();
  }, [selectedImageIds, toast, setImages, fetchImages]);

  // Create bulk animation
  const createBulkAnimation = useCallback(async (options: AnimationOptions) => {
    const selectedCount = selectedImageIds.size;
    if (selectedCount < 2) {
      toast.push('Select at least two images');
      return;
    }

    const fpsValue = Number(options.fps);
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
          loop: options.loop,
          filename: options.filename.trim() || undefined,
          namespace: namespace && namespace !== '__all__' ? namespace : undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create animation');
      }
      toast.push('Animated WebP created');
      await fetchImages({ forceRefresh: true });
    } catch (error) {
      console.error('Bulk animation failed', error);
      setBulkAnimateError(error instanceof Error ? error.message : 'Failed to create animation');
    } finally {
      setBulkAnimateLoading(false);
    }
  }, [selectedImageIds, namespace, toast, fetchImages]);

  return {
    deleteImage,
    generateAltTag,
    altLoadingMap,
    generateDisplayName,
    displayNameLoadingMap,
    editingImage,
    editTags,
    setEditTags,
    editFolderSelect,
    setEditFolderSelect,
    newEditFolder,
    setNewEditFolder,
    startEdit,
    cancelEdit,
    saveEdit,
    bulkUpdating,
    bulkDeleting,
    bulkEmbeddingGenerating,
    applyBulkUpdates,
    deleteSelectedImages,
    generateEmbeddingsForSelected,
    refreshEmbeddingsForSelected,
    queueEmbeddingsForSelected,
    bulkAnimateLoading,
    bulkAnimateError,
    setBulkAnimateError,
    createBulkAnimation,
  };
}
