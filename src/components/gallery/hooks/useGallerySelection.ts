/**
 * useGallerySelection Hook
 * 
 * Manages bulk selection state and operations.
 */

'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import type { CloudflareImage, DuplicateGroup } from '../types';
import { mergeVisibleImagesIntoSelection } from '../selectionState';

interface UseGallerySelectionOptions {
  images: CloudflareImage[];
  duplicateGroups: DuplicateGroup[];
  duplicateIds: Set<string>;
  serverDuplicateIds?: string[];
  serverDuplicateIdsExcludingNewest?: string[];
  serverDuplicateIdsExcludingOldest?: string[];
  bulkSelectionMode?: boolean;
  setBulkSelectionMode?: (value: boolean) => void;
}

interface UseGallerySelectionReturn {
  bulkSelectionMode: boolean;
  setBulkSelectionMode: (value: boolean) => void;
  selectedImageIds: Set<string>;
  selectedImages: CloudflareImage[];
  selectedCount: number;
  toggleSelection: (imageId: string) => void;
  clearSelection: () => void;
  selectAllOnPage: (pageItems: CloudflareImage[]) => void;
  selectDuplicateImages: () => boolean;
  selectDuplicatesKeepSingle: (strategy: 'newest' | 'oldest') => boolean;
}

export function useGallerySelection({
  images,
  duplicateGroups,
  duplicateIds,
  serverDuplicateIds,
  serverDuplicateIdsExcludingNewest,
  serverDuplicateIdsExcludingOldest,
  bulkSelectionMode: bulkSelectionModeOverride,
  setBulkSelectionMode: setBulkSelectionModeOverride,
}: UseGallerySelectionOptions): UseGallerySelectionReturn {
  const [internalBulkSelectionMode, setInternalBulkSelectionMode] = useState(false);
  const bulkSelectionMode = bulkSelectionModeOverride ?? internalBulkSelectionMode;
  const setBulkSelectionMode = setBulkSelectionModeOverride ?? setInternalBulkSelectionMode;
  const [selectedImageIds, setSelectedImageIds] = useState<Set<string>>(() => new Set());
  const [selectedImagesById, setSelectedImagesById] = useState<Map<string, CloudflareImage>>(
    () => new Map()
  );

  const selectedCount = selectedImageIds.size;

  // Clear selection when bulk selection mode is disabled
  useEffect(() => {
    if (!bulkSelectionMode && selectedImageIds.size) {
      setSelectedImageIds(new Set());
      setSelectedImagesById(new Map());
    }
  }, [bulkSelectionMode, selectedImageIds.size]);

  // Refresh visible records without treating a page or namespace change as a
  // deletion. Selected IDs intentionally outlive the current API response.
  useEffect(() => {
    if (!selectedImageIds.size || !images.length) return;
    setSelectedImagesById(prev => mergeVisibleImagesIntoSelection(prev, images, selectedImageIds));
  }, [images, selectedImageIds]);

  const toggleSelection = useCallback((imageId: string) => {
    const image = images.find((candidate) => candidate.id === imageId);
    const wasSelected = selectedImageIds.has(imageId);
    setSelectedImageIds(prev => {
      const next = new Set(prev);
      if (next.has(imageId)) {
        next.delete(imageId);
      } else {
        next.add(imageId);
      }
      return next;
    });
    setSelectedImagesById(prev => {
      const next = new Map(prev);
      if (wasSelected) {
        next.delete(imageId);
      } else if (image) {
        next.set(imageId, image);
      }
      return next;
    });
  }, [images, selectedImageIds]);

  const clearSelection = useCallback(() => {
    setSelectedImageIds(new Set());
    setSelectedImagesById(new Map());
  }, []);

  const selectAllOnPage = useCallback((pageItems: CloudflareImage[]) => {
    setSelectedImageIds(prev => {
      const next = new Set(prev);
      pageItems.forEach(item => next.add(item.id));
      return next;
    });
    setSelectedImagesById(prev => {
      const next = new Map(prev);
      pageItems.forEach(item => next.set(item.id, item));
      return next;
    });
  }, []);

  const selectDuplicateImages = useCallback(() => {
    const ids = serverDuplicateIds?.length ? serverDuplicateIds : Array.from(duplicateIds);
    if (!ids.length) return false;
    setBulkSelectionMode(true);
    setSelectedImageIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.add(id));
      return next;
    });
    setSelectedImagesById(prev => {
      const next = new Map(prev);
      images.forEach(image => {
        if (ids.includes(image.id)) next.set(image.id, image);
      });
      return next;
    });
    return true;
  }, [duplicateIds, images, serverDuplicateIds, setBulkSelectionMode]);

  const selectDuplicatesKeepSingle = useCallback(
    (strategy: 'newest' | 'oldest') => {
      const serverIds =
        strategy === 'newest' ? serverDuplicateIdsExcludingNewest : serverDuplicateIdsExcludingOldest;
      if (serverIds?.length) {
        setBulkSelectionMode(true);
        setSelectedImageIds(new Set(serverIds));
        setSelectedImagesById(new Map(images.filter((image) => serverIds.includes(image.id)).map((image) => [image.id, image])));
        return true;
      }
      if (!duplicateGroups.length) return false;
      
      const idsToKeep = new Set<string>();
      duplicateGroups.forEach(group => {
        const sorted = [...group.items].sort((a, b) =>
          strategy === 'newest'
            ? new Date(b.uploaded).getTime() - new Date(a.uploaded).getTime()
            : new Date(a.uploaded).getTime() - new Date(b.uploaded).getTime()
        );
        if (sorted[0]) {
          idsToKeep.add(sorted[0].id);
        }
      });
      
      setBulkSelectionMode(true);
      setSelectedImageIds(() => {
        const next = new Set<string>();
        duplicateGroups.forEach(group => {
          group.items.forEach(image => {
            if (!idsToKeep.has(image.id)) {
              next.add(image.id);
            }
          });
        });
        return next;
      });
      setSelectedImagesById(new Map(
        [...duplicateGroups.flatMap(group => group.items)]
          .filter((image) => !idsToKeep.has(image.id))
          .map((image) => [image.id, image])
      ));
      return true;
    },
    [duplicateGroups, images, serverDuplicateIdsExcludingNewest, serverDuplicateIdsExcludingOldest, setBulkSelectionMode]
  );

  const selectedImages = useMemo(
    () => Array.from(selectedImageIds, (id) => selectedImagesById.get(id) ?? {
      id,
      filename: id,
      uploaded: '',
      variants: [],
    }),
    [selectedImageIds, selectedImagesById]
  );

  return {
    bulkSelectionMode,
    setBulkSelectionMode,
    selectedImageIds,
    selectedImages,
    selectedCount,
    toggleSelection,
    clearSelection,
    selectAllOnPage,
    selectDuplicateImages,
    selectDuplicatesKeepSingle,
  };
}
