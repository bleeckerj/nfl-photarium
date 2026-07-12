import { useCallback, useMemo } from 'react';
import type {
  AspectRatioClass,
  CloudflareImage,
  DateFilter,
  EmbeddingFilter,
} from '../types';
import {
  GALLERY_RETURN_SNAPSHOT_KEY,
  saveDetailAssetSeed,
  saveGalleryReturnState as persistGalleryReturnState,
} from '../returnState';

type UseGalleryReturnStateOptions = {
  aspectRatioFilters: AspectRatioClass[];
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
        filters: {
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
        },
      });
      window.sessionStorage.setItem(
        GALLERY_RETURN_SNAPSHOT_KEY,
        JSON.stringify({
          currentPage,
          namespace: namespace ?? '',
          savedAt,
          images: pageImages,
        })
      );
    } catch {
      // ignore
    }
  }, [
    aspectRatioFilters,
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
