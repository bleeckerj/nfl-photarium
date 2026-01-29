import { useCallback } from 'react';
import type { CloudflareImage } from '../types';

interface UseGalleryItemActionsOptions {
  setImages: React.Dispatch<React.SetStateAction<CloudflareImage[]>>;
  toastPush: (message: string) => void;
  setAltLoadingMap: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  editFolderSelect: string;
  newEditFolder: string;
  editTags: string;
  setEditingImage: React.Dispatch<React.SetStateAction<string | null>>;
  setEditFolderSelect: React.Dispatch<React.SetStateAction<string>>;
  setNewEditFolder: React.Dispatch<React.SetStateAction<string>>;
  setEditTags: React.Dispatch<React.SetStateAction<string>>;
}

export const useGalleryItemActions = ({
  setImages,
  toastPush,
  setAltLoadingMap,
  editFolderSelect,
  newEditFolder,
  editTags,
  setEditingImage,
  setEditFolderSelect,
  setNewEditFolder,
  setEditTags,
}: UseGalleryItemActionsOptions) => {
  const deleteImage = useCallback(async (imageId: string) => {
    try {
      const response = await fetch(`/api/images/${imageId}`, {
        method: 'DELETE',
      });
      
      if (response.ok) {
        setImages(prev => prev.filter(img => img.id !== imageId));
      }
    } catch (error) {
      console.error('Failed to delete image:', error);
    }
  }, [setImages]);

  const generateAltTag = useCallback(async (imageId: string) => {
    setAltLoadingMap(prev => ({ ...prev, [imageId]: true }));
    try {
      const response = await fetch(`/api/images/${imageId}/alt`, {
        method: 'POST',
      });
      const data = await response.json();

      if (!response.ok) {
        const message = typeof data?.error === 'string' ? data.error : 'Failed to generate ALT text';
        toastPush(message);
        return;
      }

      if (!data?.altTag) {
        toastPush('ALT text response was empty');
        return;
      }

      setImages(prev => prev.map(img => (img.id === imageId ? { ...img, altTag: data.altTag } : img)));
      toastPush('ALT text updated');
    } catch (error) {
      console.error('Failed to generate ALT text:', error);
      toastPush('Failed to generate ALT text');
    } finally {
      setAltLoadingMap(prev => {
        const next = { ...prev };
        delete next[imageId];
        return next;
      });
    }
  }, [setAltLoadingMap, setImages, toastPush]);

  const startEdit = useCallback((image: CloudflareImage) => {
    setEditingImage(image.id);
    setEditFolderSelect(image.folder || '');
    setNewEditFolder('');
    setEditTags(image.tags ? image.tags.join(', ') : '');
  }, [setEditingImage, setEditFolderSelect, setNewEditFolder, setEditTags]);

  const cancelEdit = useCallback(() => {
    setEditingImage(null);
    setEditFolderSelect('');
    setNewEditFolder('');
    setEditTags('');
  }, [setEditingImage, setEditFolderSelect, setNewEditFolder, setEditTags]);

  const saveEdit = useCallback(async (imageId: string) => {
    try {
      const finalFolder = editFolderSelect === '__create__'
        ? (newEditFolder.trim() || undefined)
        : (editFolderSelect === '' ? undefined : editFolderSelect);

      const response = await fetch(`/api/images/${imageId}/update`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          folder: finalFolder,
          tags: editTags.trim() ? editTags.split(',').map(t => t.trim()) : []
        })
      });

      if (response.ok) {
        setImages(prev => prev.map(img => 
          img.id === imageId 
            ? { 
                ...img, 
                folder: finalFolder,
                tags: editTags.trim() ? editTags.split(',').map(t => t.trim()) : []
              }
            : img
        ));
        cancelEdit();
      } else {
        alert('Failed to update image metadata');
      }
    } catch (error) {
      console.error('Failed to update image:', error);
      alert('Failed to update image metadata');
    }
  }, [cancelEdit, editFolderSelect, editTags, newEditFolder, setImages]);

  return {
    deleteImage,
    generateAltTag,
    startEdit,
    cancelEdit,
    saveEdit,
  };
};
