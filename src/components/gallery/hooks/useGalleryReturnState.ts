import { useCallback, useMemo } from 'react';
import type {
  AspectRatioClass,
  CloudflareImage,
  DateFilter,
  EmbeddingFilter,
} from '../types';
import {
  createGalleryReturnFilterSignature,
  saveDetailAssetSeed,
  saveGalleryPageSnapshot,
  saveGalleryReturnState as persistGalleryReturnState,
} from '../returnState';

type UseGalleryReturnStateOptions = {
  aspectRatioFilters: AspectRatioClass[];
  catalogVersion: number | null;
  colorSearchHex: string | null;
  currentPage: number;
  dateFilter: DateFilter | null;
  embeddingFilter: EmbeddingFilter;
  filteredImages: CloudflareImage[];
  hiddenFolders: string[];
  hiddenTags: string[];
  hiddenNamespaces: string[];
  namespace?: string;
  onlyCanonical: boolean;
  onlyWithVariants: boolean;
  pageImages: CloudflareImage[];
  pageSize: number;
  searchTerm: string;
  selectedFolder: string;
  selectedTag: string;
  showBrokenOnly: boolean;
  showComfyOnly: boolean;
  showDuplicatesOnly: boolean;
  showFavoritesOnly: boolean;
  showMotionAssetsOnly: boolean;
};

export function useGalleryReturnState({
  aspectRatioFilters,
  catalogVersion,
  colorSearchHex,
  currentPage,
  dateFilter,
  embeddingFilter,
  filteredImages,
  hiddenFolders,
  hiddenTags,
  hiddenNamespaces,
  namespace,
  onlyCanonical,
  onlyWithVariants,
  pageImages,
  pageSize,
  searchTerm,
  selectedFolder,
  selectedTag,
  showBrokenOnly,
  showComfyOnly,
  showDuplicatesOnly,
  showFavoritesOnly,
  showMotionAssetsOnly,
}: UseGalleryReturnStateOptions) {
  const saveGalleryReturnState = useCallback((imageId: string) => {
    if (typeof window === 'undefined') return;
    try {
      const resultIds = pageImages.map((img) => img.id);
      const savedAt = Date.now();
      const selectedAsset = filteredImages.find((img) => img.id === imageId) ?? pageImages.find((img) => img.id === imageId);
      if (selectedAsset) {
        saveDetailAssetSeed(selectedAsset, namespace ?? '', savedAt);
      }
      const filters = {
        searchTerm,
        colorSearchHex,
        selectedFolder,
        selectedTag,
        onlyCanonical,
        onlyWithVariants,
        showMotionAssetsOnly,
        showFavoritesOnly,
        showDuplicatesOnly,
        showBrokenOnly,
        showComfyOnly,
        embeddingFilter,
        aspectRatioFilters,
        dateFilter,
        hiddenFolders,
        hiddenTags,
        hiddenNamespaces,
        pageSize,
        currentPage,
      };
      persistGalleryReturnState({
        scrollY: window.scrollY,
        namespace: namespace ?? '',
        savedAt,
        selectedImageId: imageId,
        resultIds,
        resultAssets: pageImages.map((img) => ({
          id: img.id,
          assetType: img.assetType === 'video' ? 'video' : 'image',
        })),
        filters,
      });
      saveGalleryPageSnapshot({
        page: currentPage,
        namespace: namespace ?? '',
        savedAt,
        images: pageImages,
        catalogVersion,
        filterSignature: createGalleryReturnFilterSignature(filters),
      });
    } catch {
      // ignore
    }
  }, [
    aspectRatioFilters,
    catalogVersion,
    colorSearchHex,
    currentPage,
    dateFilter,
    embeddingFilter,
    filteredImages,
    hiddenFolders,
    hiddenTags,
    hiddenNamespaces,
    namespace,
    onlyCanonical,
    onlyWithVariants,
    pageImages,
    pageSize,
    searchTerm,
    selectedFolder,
    selectedTag,
    showBrokenOnly,
    showComfyOnly,
    showDuplicatesOnly,
    showFavoritesOnly,
    showMotionAssetsOnly,
  ]);

  const galleryReturnHrefSuffix = useMemo(() => {
    const params = new URLSearchParams();
    params.set('gpage', String(currentPage));
    params.set('gns', namespace ?? '');
    if (colorSearchHex) {
      params.set('gcolor', colorSearchHex);
    }
    return `?${params.toString()}`;
  }, [colorSearchHex, currentPage, namespace]);

  return {
    galleryReturnHrefSuffix,
    saveGalleryReturnState,
  };
}
