/**
 * useGallerySelection Hook
 * 
 * Manages bulk selection state and operations.
 */

'use client';

import { useState, useCallback, useEffect } from 'react';
import type { CloudflareImage, DuplicateGroup } from '../types';

interface UseGallerySelectionOptions {
  images: CloudflareImage[];
  duplicateGroups: DuplicateGroup[];
  duplicateIds: Set<string>;
}

interface UseGallerySelectionReturn {
  bulkSelectionMode: boolean;
  setBulkSelectionMode: (value: boolean) => void;
  selectedImageIds: Set<string>;
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
}: UseGallerySelectionOptions): UseGallerySelectionReturn {
  const [bulkSelectionMode, setBulkSelectionMode] = useState(false);
  const [selectedImageIds, setSelectedImageIds] = useState<Set<string>>(() => new Set());

  const selectedCount = selectedImageIds.size;

  // Clear selection when bulk selection mode is disabled
  useEffect(() => {
    if (!bulkSelectionMode && selectedImageIds.size) {
      setSelectedImageIds(new Set());
    }
  }, [bulkSelectionMode, selectedImageIds.size]);

  // Clean up selection when images change (remove deleted images from selection)
  useEffect(() => {
    setSelectedImageIds(prev => {
      if (!prev.size) return prev;
      const validIds = new Set(images.map(img => img.id));
      const next = new Set<string>();
      prev.forEach(id => {
        if (validIds.has(id)) {
          next.add(id);
        }
      });
      return next;
    });
  }, [images]);

  const toggleSelection = useCallback((imageId: string) => {
    setSelectedImageIds(prev => {
      const next = new Set(prev);
      if (next.has(imageId)) {
        next.delete(imageId);
      } else {
        next.add(imageId);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedImageIds(new Set());
  }, []);

  const selectAllOnPage = useCallback((pageItems: CloudflareImage[]) => {
    setSelectedImageIds(prev => {
      const next = new Set(prev);
      pageItems.forEach(item => next.add(item.id));
      return next;
    });
  }, []);

  const selectDuplicateImages = useCallback(() => {
    if (!duplicateIds.size) return false;
    setBulkSelectionMode(true);
    setSelectedImageIds(prev => {
      const next = new Set(prev);
      duplicateIds.forEach(id => next.add(id));
      return next;
    });
    return true;
  }, [duplicateIds]);

  const selectDuplicatesKeepSingle = useCallback(
    (strategy: 'newest' | 'oldest') => {
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
      return true;
    },
    [duplicateGroups]
  );

  return {
    bulkSelectionMode,
    setBulkSelectionMode,
    selectedImageIds,
    selectedCount,
    toggleSelection,
    clearSelection,
    selectAllOnPage,
    selectDuplicateImages,
    selectDuplicatesKeepSingle,
  };
}
