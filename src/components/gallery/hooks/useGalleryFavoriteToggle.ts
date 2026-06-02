import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { patchImageFavorite } from '@/services/imageMetadataService';
import { hasFavoriteTag } from '@/utils/systemTags';
import type { CloudflareImage } from '../types';

type UseGalleryFavoriteToggleOptions = {
  images: CloudflareImage[];
  setFavoriteLoadingMap: Dispatch<SetStateAction<Record<string, boolean>>>;
  setImages: Dispatch<SetStateAction<CloudflareImage[]>>;
  toastPush: (message: string) => void;
};

export function useGalleryFavoriteToggle({
  images,
  setFavoriteLoadingMap,
  setImages,
  toastPush,
}: UseGalleryFavoriteToggleOptions) {
  return useCallback(async (imageId: string) => {
    const target = images.find(img => img.id === imageId);
    if (!target || target.assetType === 'video') {
      return;
    }

    const nextFavorite = !hasFavoriteTag(target.tags);
    setFavoriteLoadingMap(prev => ({ ...prev, [imageId]: true }));
    try {
      const { ok, payload } = await patchImageFavorite(imageId, nextFavorite);
      if (!ok || !Array.isArray(payload.tags)) {
        toastPush(payload.error || 'Failed to update favorite');
        return;
      }
      setImages(prev => prev.map(img => (img.id === imageId ? { ...img, tags: payload.tags } : img)));
      toastPush(nextFavorite ? 'Added to favorites' : 'Removed from favorites');
    } catch (error) {
      console.error('Failed to update favorite:', error);
      toastPush('Failed to update favorite');
    } finally {
      setFavoriteLoadingMap(prev => {
        const next = { ...prev };
        delete next[imageId];
        return next;
      });
    }
  }, [images, setFavoriteLoadingMap, setImages, toastPush]);
}
