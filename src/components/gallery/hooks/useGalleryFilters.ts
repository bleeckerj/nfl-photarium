/**
 * useGalleryFilters Hook
 * 
 * Manages all filter state and computed filtered image lists.
 */

'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { filterImagesForGallery } from '@/utils/galleryFilter';
import { loadHiddenFolders, loadHiddenTags, persistHiddenFolders, persistHiddenTags } from '../storage';
import { computeDuplicateGroups, buildChildrenMap } from '../utils';
import type { CloudflareImage, DateFilter, EmbeddingFilter, DuplicateGroup } from '../types';

interface UseGalleryFiltersOptions {
  images: CloudflareImage[];
  initialPreferences: {
    selectedFolder: string;
    selectedTag: string;
    searchTerm: string;
    onlyCanonical: boolean;
    respectAspectRatio: boolean;
    onlyWithVariants: boolean;
    showDuplicatesOnly: boolean;
    showBrokenOnly: boolean;
    dateFilter: DateFilter | null;
  };
  brokenImageIds: Set<string>;
}

interface UseGalleryFiltersReturn {
  // Filter state
  selectedFolder: string;
  setSelectedFolder: (folder: string) => void;
  selectedTag: string;
  setSelectedTag: (tag: string) => void;
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  onlyCanonical: boolean;
  setOnlyCanonical: (value: boolean) => void;
  respectAspectRatio: boolean;
  setRespectAspectRatio: (value: boolean) => void;
  onlyWithVariants: boolean;
  setOnlyWithVariants: (value: boolean) => void;
  showDuplicatesOnly: boolean;
  setShowDuplicatesOnly: (value: boolean) => void;
  showBrokenOnly: boolean;
  setShowBrokenOnly: (value: boolean) => void;
  embeddingFilter: EmbeddingFilter;
  setEmbeddingFilter: (filter: EmbeddingFilter) => void;
  dateFilter: DateFilter | null;
  setDateFilter: (filter: DateFilter | null) => void;
  
  // Hidden folders/tags
  hiddenFolders: string[];
  hiddenTags: string[];
  hideFolderByName: (name: string) => boolean;
  unhideFolderByName: (name: string) => boolean;
  clearHiddenFolders: () => boolean;
  hideTagByName: (name: string) => boolean;
  unhideTagByName: (name: string) => boolean;
  clearHiddenTags: () => boolean;
  
  // Computed values
  filteredImages: CloudflareImage[];
  sortedImages: CloudflareImage[];
  duplicateGroups: DuplicateGroup[];
  duplicateIds: Set<string>;
  childrenMap: Record<string, CloudflareImage[]>;
  hasActiveFilters: boolean;
  clearFilters: () => void;
}

export function useGalleryFilters({
  images,
  initialPreferences,
  brokenImageIds,
}: UseGalleryFiltersOptions): UseGalleryFiltersReturn {
  // Filter state
  const [selectedFolder, setSelectedFolder] = useState(initialPreferences.selectedFolder);
  const [selectedTag, setSelectedTag] = useState(initialPreferences.selectedTag);
  const [searchTerm, setSearchTerm] = useState(initialPreferences.searchTerm);
  const [onlyCanonical, setOnlyCanonical] = useState(initialPreferences.onlyCanonical);
  const [respectAspectRatio, setRespectAspectRatio] = useState(initialPreferences.respectAspectRatio);
  const [onlyWithVariants, setOnlyWithVariants] = useState(initialPreferences.onlyWithVariants);
  const [showDuplicatesOnly, setShowDuplicatesOnly] = useState(initialPreferences.showDuplicatesOnly);
  const [showBrokenOnly, setShowBrokenOnly] = useState(initialPreferences.showBrokenOnly);
  const [embeddingFilter, setEmbeddingFilter] = useState<EmbeddingFilter>('none');
  const [dateFilter, setDateFilter] = useState<DateFilter | null>(initialPreferences.dateFilter);
  
  // Hidden folders/tags
  const [hiddenFolders, setHiddenFolders] = useState<string[]>(() => loadHiddenFolders());
  const [hiddenTags, setHiddenTags] = useState<string[]>(() => loadHiddenTags());

  // Persist hidden folders/tags
  useEffect(() => {
    persistHiddenFolders(hiddenFolders);
  }, [hiddenFolders]);

  useEffect(() => {
    persistHiddenTags(hiddenTags);
  }, [hiddenTags]);

  // Reset selected folder if it becomes hidden
  useEffect(() => {
    if (
      selectedFolder !== 'all' &&
      selectedFolder !== 'no-folder' &&
      hiddenFolders.includes(selectedFolder)
    ) {
      setSelectedFolder('all');
    }
  }, [hiddenFolders, selectedFolder]);

  // Hidden folder operations
  const hideFolderByName = useCallback((folderName: string) => {
    const sanitized = folderName.trim();
    if (!sanitized) return false;
    let added = false;
    setHiddenFolders(prev => {
      if (prev.includes(sanitized)) return prev;
      added = true;
      return [...prev, sanitized];
    });
    return added;
  }, []);

  const unhideFolderByName = useCallback((folderName: string) => {
    const sanitized = folderName.trim();
    if (!sanitized) return false;
    let removed = false;
    setHiddenFolders(prev => {
      if (!prev.includes(sanitized)) return prev;
      removed = true;
      return prev.filter(folder => folder !== sanitized);
    });
    return removed;
  }, []);

  const clearHiddenFolders = useCallback(() => {
    if (hiddenFolders.length === 0) return false;
    setHiddenFolders([]);
    return true;
  }, [hiddenFolders]);

  // Hidden tag operations
  const hideTagByName = useCallback((tagName: string) => {
    const sanitized = tagName.trim();
    if (!sanitized) return false;
    const normalized = sanitized.toLowerCase();
    let added = false;
    setHiddenTags(prev => {
      if (prev.some(tag => tag.toLowerCase() === normalized)) return prev;
      added = true;
      return [...prev, sanitized];
    });
    return added;
  }, []);

  const unhideTagByName = useCallback((tagName: string) => {
    const sanitized = tagName.trim();
    if (!sanitized) return false;
    const normalized = sanitized.toLowerCase();
    let removed = false;
    setHiddenTags(prev => {
      if (!prev.some(tag => tag.toLowerCase() === normalized)) return prev;
      removed = true;
      return prev.filter(tag => tag.toLowerCase() !== normalized);
    });
    return removed;
  }, []);

  const clearHiddenTags = useCallback(() => {
    if (hiddenTags.length === 0) return false;
    setHiddenTags([]);
    return true;
  }, [hiddenTags]);

  // Children map
  const childrenMap = useMemo(() => buildChildrenMap(images), [images]);

  // Base filtered images
  const baseFilteredImages = useMemo(() => {
    return filterImagesForGallery(images, {
      selectedFolder,
      selectedTag,
      searchTerm,
      onlyCanonical,
      hiddenFolders,
      hiddenTags,
    });
  }, [images, selectedFolder, selectedTag, searchTerm, onlyCanonical, hiddenFolders, hiddenTags]);

  // Duplicate groups
  const duplicateGroups = useMemo(() => computeDuplicateGroups(baseFilteredImages), [baseFilteredImages]);
  
  const duplicateIds = useMemo(() => {
    const ids = new Set<string>();
    duplicateGroups.forEach(group => {
      group.items.forEach(image => ids.add(image.id));
    });
    return ids;
  }, [duplicateGroups]);

  // Filter pipeline
  const duplicateFilteredImages = useMemo(() => {
    if (!showDuplicatesOnly) return baseFilteredImages;
    return baseFilteredImages.filter(image => duplicateIds.has(image.id));
  }, [baseFilteredImages, showDuplicatesOnly, duplicateIds]);

  const duplicatesSortedByFilename = useMemo(() => {
    return showDuplicatesOnly
      ? [...duplicateFilteredImages].sort((a, b) =>
          (a.filename || '').localeCompare(b.filename || '')
        )
      : duplicateFilteredImages;
  }, [duplicateFilteredImages, showDuplicatesOnly]);

  const brokenFilteredImages = useMemo(() => {
    if (!showBrokenOnly) return duplicatesSortedByFilename;
    return duplicatesSortedByFilename.filter(image => brokenImageIds.has(image.id));
  }, [duplicatesSortedByFilename, showBrokenOnly, brokenImageIds]);

  const embeddingFilteredImages = useMemo(() => {
    if (embeddingFilter === 'none') return brokenFilteredImages;
    return brokenFilteredImages.filter(image => {
      // Type assertion: our images have embedding fields, galleryFilter's GalleryImage doesn't
      const img = image as CloudflareImage;
      if (embeddingFilter === 'missing-clip') return !img.hasClipEmbedding;
      if (embeddingFilter === 'missing-color') return !img.hasColorEmbedding;
      return !img.hasClipEmbedding || !img.hasColorEmbedding;
    });
  }, [brokenFilteredImages, embeddingFilter]);

  const filteredWithVariants = useMemo(() => {
    if (!onlyWithVariants) return embeddingFilteredImages;
    const parentIdsWithChildren = new Set(
      Object.entries(childrenMap)
        .filter(([, value]) => (value?.length ?? 0) > 0)
        .map(([key]) => key)
    );
    return embeddingFilteredImages.filter(image => parentIdsWithChildren.has(image.id));
  }, [embeddingFilteredImages, onlyWithVariants, childrenMap]);

  const sortedImages = useMemo(() => {
    return [...filteredWithVariants].sort(
      (a, b) => new Date(b.uploaded).getTime() - new Date(a.uploaded).getTime()
    );
  }, [filteredWithVariants]);

  // Date filtered
  const filteredImages = useMemo(() => {
    if (!dateFilter) return sortedImages;
    return sortedImages.filter(image => {
      const d = new Date(image.uploaded);
      return d.getFullYear() === dateFilter.year && d.getMonth() === dateFilter.month;
    });
  }, [sortedImages, dateFilter]);

  // Has active filters check
  const hasActiveFilters = Boolean(
    searchTerm.trim() ||
    selectedFolder !== 'all' ||
    selectedTag ||
    onlyCanonical ||
    respectAspectRatio ||
    onlyWithVariants ||
    showDuplicatesOnly ||
    showBrokenOnly ||
    hiddenFolders.length > 0 ||
    hiddenTags.length > 0 ||
    dateFilter !== null
  );

  // Clear all filters
  const clearFilters = useCallback(() => {
    setSearchTerm('');
    setSelectedFolder('all');
    setSelectedTag('');
    setOnlyCanonical(false);
    setRespectAspectRatio(false);
    setOnlyWithVariants(false);
    setShowDuplicatesOnly(false);
    setShowBrokenOnly(false);
    setHiddenFolders([]);
    setHiddenTags([]);
    setDateFilter(null);
  }, []);

  return {
    selectedFolder,
    setSelectedFolder,
    selectedTag,
    setSelectedTag,
    searchTerm,
    setSearchTerm,
    onlyCanonical,
    setOnlyCanonical,
    respectAspectRatio,
    setRespectAspectRatio,
    onlyWithVariants,
    setOnlyWithVariants,
    showDuplicatesOnly,
    setShowDuplicatesOnly,
    showBrokenOnly,
    setShowBrokenOnly,
    embeddingFilter,
    setEmbeddingFilter,
    dateFilter,
    setDateFilter,
    hiddenFolders,
    hiddenTags,
    hideFolderByName,
    unhideFolderByName,
    clearHiddenFolders,
    hideTagByName,
    unhideTagByName,
    clearHiddenTags,
    filteredImages,
    sortedImages,
    duplicateGroups,
    duplicateIds,
    childrenMap,
    hasActiveFilters,
    clearFilters,
  };
}
