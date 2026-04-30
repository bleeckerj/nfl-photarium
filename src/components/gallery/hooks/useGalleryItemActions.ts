import { useCallback } from 'react';
import type { CloudflareImage } from '../types';
import { getUserVisibleTags, mergeUserTagsPreservingSystemTags } from '@/utils/systemTags';

interface UseGalleryItemActionsOptions {
  images: CloudflareImage[];
  setImages: React.Dispatch<React.SetStateAction<CloudflareImage[]>>;
  toastPush: (message: string) => void;
  setAltLoadingMap: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setDisplayNameLoadingMap: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  editFolderSelect: string;
  newEditFolder: string;
  editTags: string;
  setEditingImage: React.Dispatch<React.SetStateAction<string | null>>;
  setEditFolderSelect: React.Dispatch<React.SetStateAction<string>>;
  setNewEditFolder: React.Dispatch<React.SetStateAction<string>>;
  setEditTags: React.Dispatch<React.SetStateAction<string>>;
}

export const useGalleryItemActions = ({
  images,
  setImages,
  toastPush,
  setAltLoadingMap,
  setDisplayNameLoadingMap,
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

  const generateDisplayName = useCallback(async (imageId: string) => {
    setDisplayNameLoadingMap(prev => ({ ...prev, [imageId]: true }));
    try {
      const response = await fetch(`/api/images/${imageId}/display-name`, {
        method: 'POST',
      });
      const data = await response.json();

      if (!response.ok) {
        const message = typeof data?.error === 'string' ? data.error : 'Failed to generate display name';
        toastPush(message);
        return;
      }

      if (!data?.displayName) {
        toastPush('Display name response was empty');
        return;
      }

      const saveResponse = await fetch(`/api/images/${imageId}/update`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: data.displayName }),
      });
      if (!saveResponse.ok) {
        const savePayload = await saveResponse.json().catch(() => ({}));
        const message = typeof savePayload?.error === 'string'
          ? savePayload.error
          : 'Failed to save display name';
        toastPush(message);
        return;
      }

      setImages(prev => prev.map(img => (
        img.id === imageId ? { ...img, displayName: data.displayName } : img
      )));
      toastPush('Display name updated');
    } catch (error) {
      console.error('Failed to generate display name:', error);
      toastPush('Failed to generate display name');
    } finally {
      setDisplayNameLoadingMap(prev => {
        const next = { ...prev };
        delete next[imageId];
        return next;
      });
    }
  }, [setDisplayNameLoadingMap, setImages, toastPush]);

  const startEdit = useCallback((image: CloudflareImage) => {
    setEditingImage(image.id);
    setEditFolderSelect(image.folder || '');
    setNewEditFolder('');
    setEditTags(getUserVisibleTags(image.tags).join(', '));
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
      const target = images.find(img => img.id === imageId);
      const userTags = editTags.trim() ? editTags.split(',').map(t => t.trim()).filter(Boolean) : [];
      const finalTags = mergeUserTagsPreservingSystemTags(target?.tags, userTags);

      const response = await fetch(`/api/images/${imageId}/update`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          folder: finalFolder,
          tags: finalTags
        })
      });

      if (response.ok) {
        setImages(prev => prev.map(img => 
          img.id === imageId 
            ? { 
                ...img, 
                folder: finalFolder,
                tags: finalTags
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
  }, [cancelEdit, editFolderSelect, editTags, images, newEditFolder, setImages]);

  return {
    deleteImage,
    generateAltTag,
    generateDisplayName,
    startEdit,
    cancelEdit,
    saveEdit,
  };
};
