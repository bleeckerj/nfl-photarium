import type { CloudflareImage } from './types';

/**
 * Refresh records for assets that are visible in the current page while
 * leaving records from previously visited pages and namespaces intact.
 */
export const mergeVisibleImagesIntoSelection = (
  selectedImages: ReadonlyMap<string, CloudflareImage>,
  visibleImages: CloudflareImage[],
  selectedImageIds: ReadonlySet<string>,
): Map<string, CloudflareImage> => {
  let next: Map<string, CloudflareImage> | null = null;

  for (const image of visibleImages) {
    if (!selectedImageIds.has(image.id) || selectedImages.get(image.id) === image) {
      continue;
    }
    next ??= new Map(selectedImages);
    next.set(image.id, image);
  }

  return next ?? new Map(selectedImages);
};
