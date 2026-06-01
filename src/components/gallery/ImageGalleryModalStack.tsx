'use client';

import HoverPreview from '@/components/HoverPreview';
import {
  BulkEditModal,
  CopyUrlModal,
  DeleteConfirmModal,
  EditImageModal,
  NamespaceModal,
} from './modals';
import type { AnimationOptions, BulkEditOptions } from './modals';
import type { CloudflareImage, SelectOption } from './types';

export type ImageGalleryModalStackProps = {
  images: CloudflareImage[];
  copyMenuImageId: string | null;
  onCloseCopyMenu: () => void;
  onToast: (message: string) => void;
  editingImage: string | null;
  editTags: string;
  onEditTagsChange: (value: string) => void;
  onSaveEdit: (imageId: string) => Promise<void>;
  onCancelEdit: () => void;
  onGenerateAltTag: (imageId: string) => Promise<void>;
  altLoadingMap: Record<string, boolean>;
  bulkEditOpen: boolean;
  selectedCount: number;
  folders: string[];
  namespaceOptions: SelectOption[];
  onApplyBulkUpdates: (options: BulkEditOptions) => Promise<void>;
  onCloseBulkEdit: () => void;
  bulkUpdating: boolean;
  onCreateBulkAnimation: (options: AnimationOptions) => Promise<void>;
  bulkAnimateLoading: boolean;
  bulkAnimateError: string | null;
  deleteConfirmId: string | null;
  onConfirmDelete: () => Promise<void>;
  onCancelDelete: () => void;
  namespaceSettingsOpen: boolean;
  registryNamespaces: string[];
  currentNamespace: string;
  onNamespaceChange?: (namespace: string) => void;
  onCloseNamespaceSettings: () => void;
  hoveredImage: string | null;
  showPreview: boolean;
  mousePosition: { x: number; y: number };
  onClosePreview: () => void;
};

export const ImageGalleryModalStack = ({
  images,
  copyMenuImageId,
  onCloseCopyMenu,
  onToast,
  editingImage,
  editTags,
  onEditTagsChange,
  onSaveEdit,
  onCancelEdit,
  onGenerateAltTag,
  altLoadingMap,
  bulkEditOpen,
  selectedCount,
  folders,
  namespaceOptions,
  onApplyBulkUpdates,
  onCloseBulkEdit,
  bulkUpdating,
  onCreateBulkAnimation,
  bulkAnimateLoading,
  bulkAnimateError,
  deleteConfirmId,
  onConfirmDelete,
  onCancelDelete,
  namespaceSettingsOpen,
  registryNamespaces,
  currentNamespace,
  onNamespaceChange,
  onCloseNamespaceSettings,
  hoveredImage,
  showPreview,
  mousePosition,
  onClosePreview,
}: ImageGalleryModalStackProps) => {
  const copyImage = copyMenuImageId ? images.find((img) => img.id === copyMenuImageId) : undefined;
  const editImage = editingImage ? images.find((img) => img.id === editingImage) : undefined;
  const previewImage = hoveredImage ? images.find((img) => img.id === hoveredImage) : undefined;

  return (
    <>
      {copyImage && (
        <CopyUrlModal
          image={copyImage}
          onClose={onCloseCopyMenu}
          onCopyUrl={async (url, variant, altText, shiftKey) => {
            const textToCopy = shiftKey && altText ? `${url}\n${altText}` : url;
            await navigator.clipboard.writeText(textToCopy);
            onToast(`${variant} URL copied`);
          }}
          onDownload={async (url, filename) => {
            const link = document.createElement('a');
            link.href = url;
            link.download = filename || 'image';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          }}
        />
      )}

      {editImage && editingImage && (
        <EditImageModal
          image={editImage}
          editedAltTag={editTags}
          editedTags={editTags}
          editedFilename={editImage.filename || ''}
          onAltTagChange={onEditTagsChange}
          onTagsChange={onEditTagsChange}
          onFilenameChange={() => {}}
          onSave={async () => {
            await onSaveEdit(editingImage);
          }}
          onCancel={onCancelEdit}
          onGenerateAltTag={async () => {
            await onGenerateAltTag(editingImage);
          }}
          isGeneratingAlt={altLoadingMap[editingImage] ?? false}
        />
      )}

      {bulkEditOpen && (
        <BulkEditModal
          selectedCount={selectedCount}
          folders={folders}
          namespaceOptions={namespaceOptions}
          onApply={async (options: BulkEditOptions) => {
            await onApplyBulkUpdates(options);
            onCloseBulkEdit();
          }}
          onClose={onCloseBulkEdit}
          isUpdating={bulkUpdating}
          onCreateAnimation={async (options: AnimationOptions) => {
            await onCreateBulkAnimation(options);
          }}
          isAnimating={bulkAnimateLoading}
          animationError={bulkAnimateError}
        />
      )}

      {deleteConfirmId && (
        <DeleteConfirmModal
          count={1}
          onConfirm={onConfirmDelete}
          onCancel={onCancelDelete}
        />
      )}

      {namespaceSettingsOpen && (
        <NamespaceModal
          availableNamespaces={registryNamespaces}
          currentNamespace={currentNamespace}
          onNamespaceChange={(ns: string) => {
            onNamespaceChange?.(ns);
          }}
          onClose={onCloseNamespaceSettings}
        />
      )}

      {previewImage && showPreview && hoveredImage && (
        <HoverPreview
          imageId={hoveredImage}
          filename={previewImage.filename || 'Unknown'}
          isVisible={showPreview}
          mousePosition={mousePosition}
          onClose={onClosePreview}
          dimensions={previewImage.dimensions}
        />
      )}
    </>
  );
};
