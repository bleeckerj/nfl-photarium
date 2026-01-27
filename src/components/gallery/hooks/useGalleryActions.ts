/**
 * useGalleryActions Hook
 * 
 * Handles image operations: delete, edit, generate ALT, etc.
 */

'use client';

import { useState, useCallback } from 'react';
import type { CloudflareImage } from '../types';
import { truncateMiddle } from '../utils';

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
  tagsMode: 'replace' | 'append';
  tagsInput: string;
  applyDisplayName: boolean;
  displayNameMode: 'custom' | 'auto' | 'clear';
  displayNameInput: string;
  applyNamespace: boolean;
  namespaceInput: string;
}

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
        ? (newEditFolder.trim() || undefined)
        : (editFolderSelect === '' ? undefined : editFolderSelect);

      const response = await fetch(`/api/images/${imageId}/update`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          folder: finalFolder,
          tags: editTags.trim() ? editTags.split(',').map(t => t.trim()) : [],
        }),
      });

      if (response.ok) {
        setImages(prev => prev.map(img =>
          img.id === imageId
            ? {
                ...img,
                folder: finalFolder,
                tags: editTags.trim() ? editTags.split(',').map(t => t.trim()) : [],
              }
            : img
        ));
        cancelEdit();
      } else {
        alert('Failed to update image metadata');
      }
    } catch (error) {
      console.error('Failed to update image:', error);
      alert('Failed to update image metadata');
    }
  }, [editFolderSelect, editTags, newEditFolder, setImages, cancelEdit]);

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
      (options.tagsMode === 'replace' || parsedBulkTags.length > 0);
    const hasDisplayNameChanges = options.applyDisplayName;
    const hasNamespaceChanges = options.applyNamespace;

    if (!options.applyFolder && !hasTagChanges && !hasDisplayNameChanges && !hasNamespaceChanges) {
      toast.push('Choose at least one field to update');
      return;
    }

    setBulkUpdating(true);
    try {
      await Promise.all(
        Array.from(selectedImageIds).map(id => {
          const payload: Record<string, unknown> = {};
          
          if (options.applyFolder) {
            if (options.folderMode === 'existing') {
              payload.folder = options.folderInput || undefined;
            } else if (options.folderMode === 'new') {
              payload.folder = options.folderInput.trim() || undefined;
            }
          }
          
          if (options.applyTags) {
            if (options.tagsMode === 'replace') {
              payload.tags = options.tagsInput;
            } else if (parsedBulkTags.length > 0) {
              const target = images.find(img => img.id === id);
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
              const target = images.find(img => img.id === id);
              const baseName = target?.filename || '';
              payload.displayName = truncateMiddle(baseName, 64);
            }
          }
          
          if (options.applyNamespace) {
            payload.namespace = options.namespaceInput.trim() || '';
          }
          
          return fetch(`/api/images/${id}/update`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
        })
      );

      // Update local state
      setImages(prev =>
        prev.map(img => {
          if (!selectedImageIds.has(img.id)) return img;

          let updatedFolder: string | undefined = img.folder;
          if (options.applyFolder) {
            updatedFolder = options.folderMode === 'existing'
              ? (options.folderInput || undefined)
              : (options.folderInput.trim() || undefined);
          }

          let updatedTags = img.tags;
          if (options.applyTags) {
            if (options.tagsMode === 'replace') {
              updatedTags = parsedBulkTags;
            } else if (parsedBulkTags.length > 0) {
              const merged = new Map<string, string>();
              (img.tags ?? []).forEach(tag => merged.set(tag.toLowerCase(), tag));
              parsedBulkTags.forEach(tag => merged.set(tag.toLowerCase(), tag));
              updatedTags = Array.from(merged.values());
            }
          }

          let updatedDisplayName = img.displayName;
          if (options.applyDisplayName) {
            if (options.displayNameMode === 'clear') {
              updatedDisplayName = '';
            } else if (options.displayNameMode === 'custom') {
              updatedDisplayName = options.displayNameInput.trim();
            } else if (options.displayNameMode === 'auto') {
              updatedDisplayName = truncateMiddle(img.filename || '', 64);
            }
          }

          const updatedNamespace = options.applyNamespace
            ? (options.namespaceInput.trim() || undefined)
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
  const generateEmbeddingsForSelected = useCallback(async () => {
    const selectedCount = selectedImageIds.size;
    if (!selectedCount) {
      toast.push('Select images to generate embeddings');
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

      toast.push(`Generated embeddings: ${result.success} success, ${result.skipped} skipped, ${result.errors} errors`);
    } catch (error) {
      console.error('Batch embedding generation failed', error);
      toast.push(error instanceof Error ? error.message : 'Embedding generation failed');
    } finally {
      setBulkEmbeddingGenerating(false);
    }
  }, [selectedImageIds, setImages, toast]);

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
    bulkAnimateLoading,
    bulkAnimateError,
    setBulkAnimateError,
    createBulkAnimation,
  };
}
