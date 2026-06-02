import { useEffect } from 'react';
import type {
  AspectRatioClass,
  BulkFolderMode,
  DateFilter,
  GridSize,
  ViewMode,
} from '../types';

type UseGalleryPreferencePersistenceOptions = {
  aspectRatioFilters: AspectRatioClass[];
  bulkFolderInput: string;
  bulkFolderMode: BulkFolderMode;
  controlsVisiblePreference: boolean;
  currentPage: number;
  dateFilter: DateFilter | null;
  filtersCollapsed: boolean;
  gridSize: GridSize;
  onlyCanonical: boolean;
  onlyWithVariants: boolean;
  pageSize: number;
  respectAspectRatio: boolean;
  searchTerm: string;
  selectedFolder: string;
  selectedTag: string;
  selectedVariant: string;
  showBrokenOnly: boolean;
  showCli: boolean;
  showComfyOnly: boolean;
  showDuplicatesOnly: boolean;
  showFavoritesOnly: boolean;
  showMotionAssetsOnly: boolean;
  viewMode: ViewMode;
};

export function useGalleryPreferencePersistence({
  aspectRatioFilters,
  bulkFolderInput,
  bulkFolderMode,
  controlsVisiblePreference,
  currentPage,
  dateFilter,
  filtersCollapsed,
  gridSize,
  onlyCanonical,
  onlyWithVariants,
  pageSize,
  respectAspectRatio,
  searchTerm,
  selectedFolder,
  selectedTag,
  selectedVariant,
  showBrokenOnly,
  showCli,
  showComfyOnly,
  showDuplicatesOnly,
  showFavoritesOnly,
  showMotionAssetsOnly,
  viewMode,
}: UseGalleryPreferencePersistenceOptions) {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem('galleryPreferences', JSON.stringify({
        onlyCanonical,
        respectAspectRatio,
        variant: selectedVariant,
        onlyWithVariants,
        showMotionAssetsOnly,
        showFavoritesOnly,
        showComfyOnly,
        selectedFolder,
        selectedTag,
        searchTerm,
        viewMode,
        gridSize,
        filtersCollapsed,
        bulkFolderInput,
        bulkFolderMode,
        showDuplicatesOnly,
        showBrokenOnly,
        aspectRatioFilters,
        showCli,
        controlsVisible: controlsVisiblePreference,
        pageSize,
        dateFilter,
        currentPage,
      }));
    } catch (error) {
      console.warn('Failed to save gallery prefs', error);
    }
  }, [
    aspectRatioFilters,
    bulkFolderInput,
    bulkFolderMode,
    controlsVisiblePreference,
    currentPage,
    dateFilter,
    filtersCollapsed,
    gridSize,
    onlyCanonical,
    onlyWithVariants,
    pageSize,
    respectAspectRatio,
    searchTerm,
    selectedFolder,
    selectedTag,
    selectedVariant,
    showBrokenOnly,
    showCli,
    showComfyOnly,
    showDuplicatesOnly,
    showFavoritesOnly,
    showMotionAssetsOnly,
    viewMode,
  ]);
}
