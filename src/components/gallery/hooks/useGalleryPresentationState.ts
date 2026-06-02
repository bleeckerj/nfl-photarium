import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';
import { normalizeColorSearchHex, type ColorSearchResultRow } from '../colorSearch';
import type {
  CloudflareImage,
  GalleryFamilySummary,
} from '../types';
import type { EmbeddingPendingEntry } from '@/utils/embeddingPending';
import type { GalleryServerPagination } from '../serverState';

type UseGalleryViewFiltersOptions = {
  activeColorSearchHex: string | null;
  altLoadingMap: Record<string, boolean>;
  bulkSelectionMode: boolean;
  childrenMap: Record<string, CloudflareImage[]>;
  colorMetadataMap: Record<string, { dominantColors?: string[]; averageColor?: string }>;
  displayNameLoadingMap: Record<string, boolean>;
  duplicateIds: Set<string>;
  embeddingPendingMap: Record<string, EmbeddingPendingEntry>;
  familySummaryMap: Record<string, GalleryFamilySummary>;
  favoriteLoadingMap: Record<string, boolean>;
  focusedGalleryAssetId: string | null;
  galleryReturnHrefSuffix: string;
  pageImages: CloudflareImage[];
  respectAspectRatio: boolean;
  selectedImageIds: Set<string>;
  selectedVariant: string;
};

type UseGalleryColorActionsOptions = {
  clearColorSearch: () => void;
  clearFilters: () => void;
  goToFirstPage: () => void;
  scrollGalleryToTop: () => void;
  setColorSearchError: (value: string | null) => void;
  setColorSearchHex: (value: string | null) => void;
  setColorSearchRows: Dispatch<SetStateAction<ColorSearchResultRow[]>>;
};

type UseGalleryResultCountsOptions = {
  colorSearchHex: string | null;
  filteredWithVariants: CloudflareImage[];
  images: CloudflareImage[];
  serverPagination: GalleryServerPagination | null;
};

export function useGalleryViewFilters({
  activeColorSearchHex,
  altLoadingMap,
  bulkSelectionMode,
  childrenMap,
  colorMetadataMap,
  displayNameLoadingMap,
  duplicateIds,
  embeddingPendingMap,
  familySummaryMap,
  favoriteLoadingMap,
  focusedGalleryAssetId,
  galleryReturnHrefSuffix,
  pageImages,
  respectAspectRatio,
  selectedImageIds,
  selectedVariant,
}: UseGalleryViewFiltersOptions) {
  return useMemo(() => ({
    images: pageImages,
    selectedVariant,
    respectAspectRatio,
    bulkSelectionMode,
    selectedImageIds,
    duplicateIds,
    childrenMap,
    familySummaryMap,
    colorMetadataMap,
    embeddingPendingMap,
    altLoadingMap,
    displayNameLoadingMap,
    favoriteLoadingMap,
    galleryReturnHrefSuffix,
    activeColorSearchHex,
    focusedGalleryAssetId,
  }), [
    activeColorSearchHex,
    altLoadingMap,
    bulkSelectionMode,
    childrenMap,
    colorMetadataMap,
    displayNameLoadingMap,
    duplicateIds,
    embeddingPendingMap,
    familySummaryMap,
    favoriteLoadingMap,
    focusedGalleryAssetId,
    galleryReturnHrefSuffix,
    pageImages,
    respectAspectRatio,
    selectedImageIds,
    selectedVariant,
  ]);
}

export function useGalleryColorActions({
  clearColorSearch,
  clearFilters,
  goToFirstPage,
  scrollGalleryToTop,
  setColorSearchError,
  setColorSearchHex,
  setColorSearchRows,
}: UseGalleryColorActionsOptions) {
  const handleSelectColor = useCallback((hex: string) => {
    const normalized = normalizeColorSearchHex(hex);
    if (!normalized) return;
    setColorSearchHex(normalized);
    setColorSearchRows([]);
    setColorSearchError(null);
    goToFirstPage();
    scrollGalleryToTop();
  }, [goToFirstPage, scrollGalleryToTop, setColorSearchError, setColorSearchHex, setColorSearchRows]);

  const handleClearFilters = useCallback(() => {
    clearFilters();
    clearColorSearch();
  }, [clearColorSearch, clearFilters]);

  return { handleClearFilters, handleSelectColor };
}

export function useGalleryResultCounts({
  colorSearchHex,
  filteredWithVariants,
  images,
  serverPagination,
}: UseGalleryResultCountsOptions) {
  const serverPagedResultCount = colorSearchHex ? null : serverPagination?.total ?? null;
  const galleryResultCount = serverPagedResultCount ?? filteredWithVariants.length;
  const galleryTotalCount =
    !colorSearchHex && serverPagination?.scopeTotal !== undefined
      ? serverPagination.scopeTotal
      : serverPagedResultCount ?? images.length;

  return { galleryResultCount, galleryTotalCount };
}
