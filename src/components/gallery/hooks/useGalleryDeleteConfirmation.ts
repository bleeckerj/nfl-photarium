import { useCallback, useState } from 'react';

type DeleteImage = (imageId: string) => Promise<void>;

export const useGalleryDeleteConfirmation = (deleteImage: DeleteImage) => {
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteConfirmDeleting, setDeleteConfirmDeleting] = useState(false);

  const requestDeleteImage = useCallback((imageId: string) => {
    setDeleteConfirmId(imageId);
  }, []);

  const cancelDeleteImage = useCallback(() => {
    if (deleteConfirmDeleting) return;
    setDeleteConfirmId(null);
  }, [deleteConfirmDeleting]);

  const confirmDeleteImage = useCallback(async () => {
    if (!deleteConfirmId || deleteConfirmDeleting) return;
    setDeleteConfirmDeleting(true);
    try {
      await deleteImage(deleteConfirmId);
      setDeleteConfirmId(null);
    } catch {
      // The delete action hook already reports the user-visible error.
    } finally {
      setDeleteConfirmDeleting(false);
    }
  }, [deleteConfirmDeleting, deleteConfirmId, deleteImage]);

  return {
    deleteConfirmId,
    deleteConfirmDeleting,
    requestDeleteImage,
    cancelDeleteImage,
    confirmDeleteImage,
  };
};
