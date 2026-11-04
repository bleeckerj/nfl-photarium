import { useCallback, useState } from 'react';
import type { CloudflareImage } from '../types';
import { createSelectionArchive, saveSelectionArchive } from '../selectionDownload';

export function useSelectionDownload(selectedImages: CloudflareImage[], toastPush: (message: string) => void) {
  const [downloading, setDownloading] = useState(false);
  const download = useCallback(async () => {
    if (downloading) return;
    const images = selectedImages.filter((image) => image.assetType !== 'video');
    const skipped = selectedImages.length - images.length;
    if (!images.length) {
      toastPush('Select at least one image to download. Videos are not included.');
      return;
    }
    setDownloading(true);
    try {
      toastPush(`Preparing ${images.length} original image${images.length === 1 ? '' : 's'} for download${skipped ? `; ${skipped} video${skipped === 1 ? '' : 's'} skipped` : ''}.`);
      const archive = await createSelectionArchive(images);
      saveSelectionArchive(archive);
      toastPush(`Download started: ${images.length} original image${images.length === 1 ? '' : 's'}${skipped ? `; ${skipped} video${skipped === 1 ? '' : 's'} skipped` : ''}.`);
    } catch (error) {
      toastPush(error instanceof Error ? error.message : 'Could not download selected images.');
    } finally {
      setDownloading(false);
    }
  }, [downloading, selectedImages, toastPush]);
  return { downloading, download };
}
