import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { UploadedImage } from '@/components/image-uploader/types';
import type { UploaderQueueItem } from '@/features/page-import/types';

interface UseUploadedImageActionsOptions {
  setUploadedImages: Dispatch<SetStateAction<UploadedImage[]>>;
  uploadFiles: (items: UploaderQueueItem[]) => void;
  uploadRemoteFiles: (items: UploaderQueueItem[]) => void;
}

export function useUploadedImageActions({
  setUploadedImages,
  uploadFiles,
  uploadRemoteFiles,
}: UseUploadedImageActionsOptions) {
  const removeImage = useCallback((id: string) => {
    setUploadedImages((prev) => prev.filter((img) => img.id !== id));
  }, [setUploadedImages]);

  const handleRetryUpload = useCallback(
    (image: UploadedImage, options?: { overrideDuplicate?: boolean }) => {
      const duplicateAction = options?.overrideDuplicate ? 'override' : undefined;
      if (image.file) {
        const retryItem: UploaderQueueItem = {
          id: image.id,
          assetType: image.assetType,
          file: image.file,
          filename: image.filename,
          originalUrl: image.originalUrlInput ?? image.originalUrl,
          sourceUrl: image.sourceUrlInput ?? image.sourceUrl,
          folder: image.folderInput,
          tags: image.tagsInput,
          description: image.descriptionInput,
          selected: true,
          duplicateAction,
        };
        uploadFiles([retryItem]);
        return;
      }
      if (image.remoteUrl) {
        const retryItem: UploaderQueueItem = {
          id: image.id,
          assetType: image.assetType,
          filename: image.filename,
          remoteUrl: image.remoteUrl,
          posterUrl: image.url || undefined,
          originalUrl: image.originalUrlInput ?? image.originalUrl,
          sourceUrl: image.sourceUrlInput ?? image.sourceUrl,
          folder: image.folderInput,
          tags: image.tagsInput,
          description: image.descriptionInput,
          selected: true,
          duplicateAction,
        };
        uploadRemoteFiles([retryItem]);
      }
    },
    [uploadFiles, uploadRemoteFiles]
  );

  return { removeImage, handleRetryUpload };
}
