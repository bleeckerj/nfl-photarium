/**
 * useGalleryFilters Hook
 * 
 * Manages all filter state and computed filtered image lists.
 */

'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { filterImagesForGallery } from '@/utils/galleryFilter';
import { loadHiddenFolders, loadHiddenTags, persistHiddenFolders, persistHiddenTags } from '../storage';
import { computeDuplicateGroups, buildChildrenMap, formatDateRangeLabel } from '../utils';
import { DEFAULT_PAGE_SIZE } from '../constants';
import { getDateKeyRangeMs } from '../dateFilter';
import type { CloudflareImage, DateFilter, EmbeddingFilter, DuplicateGroup, AspectRatioClass } from '../types';

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
    showComfyOnly?: boolean;
    embeddingFilter?: EmbeddingFilter;
    aspectRatioFilters?: AspectRatioClass[];
    dateFilter: DateFilter | null;
    hiddenFolders?: string[];
    hiddenTags?: string[];
    pageSize?: number;
    currentPage?: number;
  };
  brokenImageIds: Set<string>;
  isLoading?: boolean;
  returningFromDetailRef?: React.MutableRefObject<boolean>;
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
  showComfyOnly: boolean;
  setShowComfyOnly: (value: boolean) => void;
  embeddingFilter: EmbeddingFilter;
  setEmbeddingFilter: (filter: EmbeddingFilter) => void;
  aspectRatioFilters: AspectRatioClass[];
  setAspectRatioFilters: (filters: AspectRatioClass[]) => void;
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
  filteredWithVariants: CloudflareImage[];
  sortedImages: CloudflareImage[];
  duplicateGroups: DuplicateGroup[];
  duplicateIds: Set<string>;
  childrenMap: Record<string, CloudflareImage[]>;
  hasActiveFilters: boolean;
  clearFilters: () => void;

  // Pagination
  currentPage: number;
  setCurrentPage: (page: number) => void;
  pageSize: number;
  setPageSize: (size: number) => void;
  totalPages: number;
  pageImages: CloudflareImage[];
  showPagination: boolean;
  hasResults: boolean;
  pageIndex: number;
  currentPageRangeLabel: string | null;
  prevPageRangeLabel: string | null;
  nextPageRangeLabel: string | null;
  goToPageNumber: (page: number) => void;
  goToPreviousPage: () => void;
  goToNextPage: () => void;
  goToFirstPage: () => void;
  goToLastPage: () => void;
  jumpBackTenPages: () => void;
  jumpForwardTenPages: () => void;
  scrollGalleryToTop: () => void;
}

export function useGalleryFilters({
  images,
  initialPreferences,
  brokenImageIds,
  isLoading = false,
  returningFromDetailRef,
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
  const [showComfyOnly, setShowComfyOnly] = useState(Boolean(initialPreferences.showComfyOnly));
  const [embeddingFilter, setEmbeddingFilter] = useState<EmbeddingFilter>(
    initialPreferences.embeddingFilter ?? 'none'
  );
  const [aspectRatioFilters, setAspectRatioFilters] = useState<AspectRatioClass[]>(
    initialPreferences.aspectRatioFilters ?? []
  );
  const [dateFilter, setDateFilter] = useState<DateFilter | null>(initialPreferences.dateFilter);
  const [currentPage, setCurrentPage] = useState(initialPreferences.currentPage ?? 1);
  const [pageSize, setPageSize] = useState(initialPreferences.pageSize ?? DEFAULT_PAGE_SIZE);
  
  // Hidden folders/tags
  const [hiddenFolders, setHiddenFolders] = useState<string[]>(
    () => initialPreferences.hiddenFolders ?? loadHiddenFolders()
  );
  const [hiddenTags, setHiddenTags] = useState<string[]>(
    () => initialPreferences.hiddenTags ?? loadHiddenTags()
  );
  const didInitFilterPageRef = useRef(false);

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

  const comfyFilteredImages = useMemo(() => {
    if (!showComfyOnly) return brokenFilteredImages;
    return brokenFilteredImages.filter((image) => {
      const generatedBy = typeof image.generatedBy === 'string' ? image.generatedBy.toLowerCase() : '';
      return generatedBy === 'comfyui' || image.comfyMetadataDetected === true || Boolean(image.comfyMetadataSource);
    });
  }, [brokenFilteredImages, showComfyOnly]);

  const embeddingFilteredImages = useMemo(() => {
    if (embeddingFilter === 'none') return comfyFilteredImages;
    return comfyFilteredImages.filter(image => {
      // Type assertion: our images have embedding fields, galleryFilter's GalleryImage doesn't
      const img = image as CloudflareImage;
      if (embeddingFilter === 'missing-clip') return !img.hasClipEmbedding;
      if (embeddingFilter === 'missing-color') return !img.hasColorEmbedding;
      if (embeddingFilter === 'missing-both') return !img.hasClipEmbedding && !img.hasColorEmbedding;
      return !img.hasClipEmbedding || !img.hasColorEmbedding;
    });
  }, [comfyFilteredImages, embeddingFilter]);

  const aspectRatioFilteredImages = useMemo(() => {
    if (!aspectRatioFilters.length) return embeddingFilteredImages;
    return embeddingFilteredImages.filter(image => {
      if (image.assetType === 'video') return true;
      if (!image.dimensions?.width || !image.dimensions?.height) return false;
      const ratio = image.dimensions.width / image.dimensions.height;
      const isSquare = Math.abs(ratio - 1) <= 0.05;
      const isHorizontal = ratio > 1.05;
      const isVertical = ratio < 0.95;
      return (
        (aspectRatioFilters.includes('square') && isSquare) ||
        (aspectRatioFilters.includes('horizontal') && isHorizontal) ||
        (aspectRatioFilters.includes('vertical') && isVertical)
      );
    });
  }, [embeddingFilteredImages, aspectRatioFilters]);

  const filteredWithVariants = useMemo(() => {
    if (!onlyWithVariants) return aspectRatioFilteredImages;
    const parentIdsWithChildren = new Set(
      Object.entries(childrenMap)
        .filter(([, value]) => (value?.length ?? 0) > 0)
        .map(([key]) => key)
    );
    return aspectRatioFilteredImages.filter(image => parentIdsWithChildren.has(image.id));
  }, [aspectRatioFilteredImages, onlyWithVariants, childrenMap]);

  const sortedImages = useMemo(() => {
    return [...filteredWithVariants].sort(
      (a, b) => new Date(b.uploaded).getTime() - new Date(a.uploaded).getTime()
    );
  }, [filteredWithVariants]);

  // Date filtered
  const filteredImages = useMemo(() => {
    if (!dateFilter) return sortedImages;
    const range = getDateKeyRangeMs(dateFilter);
    if (!range) return sortedImages;
    return sortedImages.filter(image => {
      const uploadedMs = new Date(image.uploaded).getTime();
      if (Number.isNaN(uploadedMs)) {
        return false;
      }
      return uploadedMs >= range.startMs && uploadedMs <= range.endMs;
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
    showComfyOnly ||
    embeddingFilter !== 'none' ||
    aspectRatioFilters.length > 0 ||
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
    setShowComfyOnly(false);
    setEmbeddingFilter('none');
    setAspectRatioFilters([]);
    setHiddenFolders([]);
    setHiddenTags([]);
    setDateFilter(null);
  }, []);

  const scrollGalleryToTop = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  }, []);

  const totalPages = Math.max(1, Math.ceil(filteredImages.length / pageSize));
  const pageIndex = Math.min(currentPage, totalPages);
  const pageSliceStart = (pageIndex - 1) * pageSize;
  const pageImages = filteredImages.slice(pageSliceStart, pageSliceStart + pageSize);
  const showPagination = filteredImages.length > pageSize;
  const hasResults = filteredImages.length > 0;

  const currentPageRangeLabel = useMemo(() => formatDateRangeLabel(pageImages), [pageImages]);

  const getPageDateRangeLabel = useCallback(
    (pageNumber: number) => {
      if (pageNumber < 1 || pageNumber > totalPages) return null;
      const startIndex = (pageNumber - 1) * pageSize;
      const slice = filteredImages.slice(startIndex, startIndex + pageSize);
      return formatDateRangeLabel(slice);
    },
    [filteredImages, pageSize, totalPages]
  );

  const prevPageRangeLabel = useMemo(
    () => getPageDateRangeLabel(pageIndex - 1),
    [getPageDateRangeLabel, pageIndex]
  );
  const nextPageRangeLabel = useMemo(
    () => getPageDateRangeLabel(pageIndex + 1),
    [getPageDateRangeLabel, pageIndex]
  );

  const goToPageNumber = useCallback(
    (target: number) => {
      setCurrentPage(prev => {
        const next = Math.min(Math.max(1, target), totalPages);
        if (next !== prev) {
          scrollGalleryToTop();
        }
        return next;
      });
    },
    [scrollGalleryToTop, totalPages]
  );

  const goToPreviousPage = useCallback(() => goToPageNumber(pageIndex - 1), [goToPageNumber, pageIndex]);
  const goToNextPage = useCallback(() => goToPageNumber(pageIndex + 1), [goToPageNumber, pageIndex]);
  const goToFirstPage = useCallback(() => goToPageNumber(1), [goToPageNumber]);
  const goToLastPage = useCallback(() => goToPageNumber(totalPages), [goToPageNumber, totalPages]);
  const jumpBackTenPages = useCallback(() => goToPageNumber(pageIndex - 10), [goToPageNumber, pageIndex]);
  const jumpForwardTenPages = useCallback(() => goToPageNumber(pageIndex + 10), [goToPageNumber, pageIndex]);

  useEffect(() => {
    if (!didInitFilterPageRef.current) {
      didInitFilterPageRef.current = true;
      return;
    }

    if (returningFromDetailRef?.current) {
      returningFromDetailRef.current = false;
      return;
    }
    setCurrentPage(1);
    scrollGalleryToTop();
  }, [
    selectedFolder,
    selectedTag,
    searchTerm,
    onlyWithVariants,
    showDuplicatesOnly,
    showBrokenOnly,
    showComfyOnly,
    embeddingFilter,
    pageSize,
    dateFilter,
    scrollGalleryToTop,
    returningFromDetailRef,
  ]);

  useEffect(() => {
    if (isLoading) return;
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, isLoading, totalPages]);

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
    showComfyOnly,
    setShowComfyOnly,
    embeddingFilter,
    setEmbeddingFilter,
    aspectRatioFilters,
    setAspectRatioFilters,
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
    filteredWithVariants,
    sortedImages,
    duplicateGroups,
    duplicateIds,
    childrenMap,
    hasActiveFilters,
    clearFilters,
    currentPage,
    setCurrentPage,
    pageSize,
    setPageSize,
    totalPages,
    pageImages,
    showPagination,
    hasResults,
    pageIndex,
    currentPageRangeLabel,
    prevPageRangeLabel,
    nextPageRangeLabel,
    goToPageNumber,
    goToPreviousPage,
    goToNextPage,
    goToFirstPage,
    goToLastPage,
    jumpBackTenPages,
    jumpForwardTenPages,
    scrollGalleryToTop,
  };
}
