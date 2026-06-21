/**
 * GalleryModals Component
 * 
 * Wrapper for all gallery modals.
 */

'use client';

import React from 'react';
import { GalleryCopyModal } from './GalleryCopyModal';
import { GalleryBulkEditModal } from './GalleryBulkEditModal';
import { GalleryEditModal } from './GalleryEditModal';
import { GalleryNamespaceModal } from './GalleryNamespaceModal';
import { DeleteConfirmModal } from './modals';
import type { CloudflareImage, SelectOption } from './types';

interface GalleryModalsProps {
  images: CloudflareImage[];
  openCopyMenu: string | null;
  onCloseCopyMenu: () => void;
  getVariantUrls: (image: CloudflareImage) => Record<string, string>;
  getVariantWidthLabel: (variant: string) => string | null;
  onCopyUrl: (
    event: React.MouseEvent<HTMLButtonElement>,
    url: string,
    variant: string,
    altText?: string
  ) => Promise<void>;
  onDownload: (url: string, filename?: string) => Promise<void>;

  namespaceModalOpen: boolean;
  namespaceSelectValue: string;
  namespaceDraft: string;
  namespaceOptions: SelectOption[];
  onNamespaceSelectChange: (value: string) => void;
  onNamespaceDraftChange: (value: string) => void;
  onNamespaceCancel: () => void;
  onNamespaceSave: () => void;
  selectedNamespaceForDelete?: string;
  canDeleteSelectedNamespace?: boolean;
  deletingNamespace?: boolean;
  onDeleteNamespace?: () => void;
  namespaceRenameTarget?: string;
  canRenameSelectedNamespace?: boolean;
  renamingNamespace?: boolean;
  onNamespaceRenameTargetChange?: (value: string) => void;
  onRenameNamespace?: () => void;

  editingImage: string | null;
  editFolderSelect: string;
  editFolderOptions: SelectOption[];
  newEditFolder: string;
  editTags: string;
  onEditFolderSelect: (value: string) => void;
  onNewEditFolderChange: (value: string) => void;
  onEditTagsChange: (value: string) => void;
  onEditCancel: () => void;
  onEditSave: () => void;

  deleteConfirmImageId: string | null;
  deleteConfirmDeleting: boolean;
  onDeleteConfirm: () => Promise<void>;
  onDeleteCancel: () => void;

  bulkEditOpen: boolean;
  selectedCount: number;
  selectedImagesForPayload: Array<{
    id: string;
    filename: string;
    altText?: string;
    altTag?: string;
  }>;
  selectedAnimationPreview: Array<{
    id: string;
    filename: string;
    altText?: string;
    altTag?: string;
  }>;
  bulkAnimateOrderMode: 'gallery' | 'reverse-gallery';
  onBulkAnimateOrderModeChange: (value: 'gallery' | 'reverse-gallery') => void;
  bulkAnimateSelectionOrderDiffers: boolean;
  onCopySelectionPayload: (payload: string) => void | Promise<void>;
  bulkApplyFolder: boolean;
  onBulkApplyFolderChange: (value: boolean) => void;
  bulkFolderMode: 'existing' | 'new';
  bulkFolderInput: string;
  onBulkFolderInputChange: (value: string) => void;
  bulkFolderOptions: SelectOption[];
  onBulkFolderSelect: (value: string) => void;
  bulkApplyTags: boolean;
  onBulkApplyTagsChange: (value: boolean) => void;
  bulkTagsMode: 'replace' | 'append' | 'ai';
  onBulkTagsModeChange: (value: 'replace' | 'append' | 'ai') => void;
  bulkTagsInput: string;
  onBulkTagsInputChange: (value: string) => void;
  bulkTagsAiCount: string;
  onBulkTagsAiCountChange: (value: string) => void;
  bulkApplyDisplayName: boolean;
  onBulkApplyDisplayNameChange: (value: boolean) => void;
  bulkDisplayNameMode: 'custom' | 'auto' | 'clear' | 'ai';
  onBulkDisplayNameModeChange: (value: 'custom' | 'auto' | 'clear' | 'ai') => void;
  bulkDisplayNameInput: string;
  onBulkDisplayNameInputChange: (value: string) => void;
  bulkApplyDescription: boolean;
  onBulkApplyDescriptionChange: (value: boolean) => void;
  bulkDescriptionAppendInput: string;
  onBulkDescriptionAppendInputChange: (value: string) => void;
  bulkApplyNamespace: boolean;
  onBulkApplyNamespaceChange: (value: boolean) => void;
  bulkNamespaceInput: string;
  onBulkNamespaceInputChange: (value: string) => void;
  registryNamespaces: string[];
  onRegisterNamespace: (namespace: string, description?: string) => Promise<boolean>;
  bulkAnimateFps: string;
  onBulkAnimateFpsChange: (value: string) => void;
  bulkAnimateTouched: boolean;
  onBulkAnimateTouchedChange: (value: boolean) => void;
  bulkAnimateLoop: boolean;
  onBulkAnimateLoopChange: (value: boolean) => void;
  bulkAnimateNamespaceInput: string;
  onBulkAnimateNamespaceInputChange: (value: string) => void;
  bulkAnimateFilename: string;
  onBulkAnimateFilenameChange: (value: string) => void;
  bulkAnimateLoading: boolean;
  bulkAnimateError: string | null;
  bulkUpdating: boolean;
  onBulkApply: (options?: { namespaceOverride?: string }) => void | Promise<void>;
  onBulkCreateAnimation: () => void;
  onBulkClose: () => void;
}

export const GalleryModals: React.FC<GalleryModalsProps> = ({
  images,
  openCopyMenu,
  onCloseCopyMenu,
  getVariantUrls,
  getVariantWidthLabel,
  onCopyUrl,
  onDownload,
  namespaceModalOpen,
  namespaceSelectValue,
  namespaceDraft,
  namespaceOptions,
  onNamespaceSelectChange,
  onNamespaceDraftChange,
  onNamespaceCancel,
  onNamespaceSave,
  selectedNamespaceForDelete,
  canDeleteSelectedNamespace,
  deletingNamespace,
  onDeleteNamespace,
  namespaceRenameTarget,
  canRenameSelectedNamespace,
  renamingNamespace,
  onNamespaceRenameTargetChange,
  onRenameNamespace,
  editingImage,
  editFolderSelect,
  editFolderOptions,
  newEditFolder,
  editTags,
  onEditFolderSelect,
  onNewEditFolderChange,
  onEditTagsChange,
  onEditCancel,
  onEditSave,
  deleteConfirmImageId,
  deleteConfirmDeleting,
  onDeleteConfirm,
  onDeleteCancel,
  bulkEditOpen,
  selectedCount,
  selectedImagesForPayload,
  selectedAnimationPreview,
  bulkAnimateOrderMode,
  onBulkAnimateOrderModeChange,
  bulkAnimateSelectionOrderDiffers,
  onCopySelectionPayload,
  bulkApplyFolder,
  onBulkApplyFolderChange,
  bulkFolderMode,
  bulkFolderInput,
  onBulkFolderInputChange,
  bulkFolderOptions,
  onBulkFolderSelect,
  bulkApplyTags,
  onBulkApplyTagsChange,
  bulkTagsMode,
  onBulkTagsModeChange,
  bulkTagsInput,
  onBulkTagsInputChange,
  bulkTagsAiCount,
  onBulkTagsAiCountChange,
  bulkApplyDisplayName,
  onBulkApplyDisplayNameChange,
  bulkDisplayNameMode,
  onBulkDisplayNameModeChange,
  bulkDisplayNameInput,
  onBulkDisplayNameInputChange,
  bulkApplyDescription,
  onBulkApplyDescriptionChange,
  bulkDescriptionAppendInput,
  onBulkDescriptionAppendInputChange,
  bulkApplyNamespace,
  onBulkApplyNamespaceChange,
  bulkNamespaceInput,
  onBulkNamespaceInputChange,
  registryNamespaces,
  onRegisterNamespace,
  bulkAnimateFps,
  onBulkAnimateFpsChange,
  bulkAnimateTouched,
  onBulkAnimateTouchedChange,
  bulkAnimateLoop,
  onBulkAnimateLoopChange,
  bulkAnimateNamespaceInput,
  onBulkAnimateNamespaceInputChange,
  bulkAnimateFilename,
  onBulkAnimateFilenameChange,
  bulkAnimateLoading,
  bulkAnimateError,
  bulkUpdating,
  onBulkApply,
  onBulkCreateAnimation,
  onBulkClose,
}) => {
  const copyModalImage = openCopyMenu ? images.find((image) => image.id === openCopyMenu) : null;
  const copyItems = copyModalImage
    ? Object.entries(getVariantUrls(copyModalImage)).map(([variant, url]) => ({
        variant,
        url: String(url),
        widthLabel: getVariantWidthLabel(variant) ?? undefined,
      }))
    : [];

  return (
    <>
      {copyModalImage && (
        <GalleryCopyModal
          items={copyItems}
          altText={copyModalImage.altTag}
          filename={copyModalImage.filename}
          onClose={onCloseCopyMenu}
          onCopyUrl={onCopyUrl}
          onDownload={onDownload}
        />
      )}

      <GalleryNamespaceModal
        isOpen={namespaceModalOpen}
        namespaceSelectValue={namespaceSelectValue}
        namespaceDraft={namespaceDraft}
        namespaceOptions={namespaceOptions}
        onSelectChange={onNamespaceSelectChange}
        onDraftChange={onNamespaceDraftChange}
        onCancel={onNamespaceCancel}
        onSave={onNamespaceSave}
        selectedNamespaceForDelete={selectedNamespaceForDelete}
        canDeleteSelectedNamespace={canDeleteSelectedNamespace}
        deletingNamespace={deletingNamespace}
        onDeleteNamespace={onDeleteNamespace}
        namespaceRenameTarget={namespaceRenameTarget}
        canRenameSelectedNamespace={canRenameSelectedNamespace}
        renamingNamespace={renamingNamespace}
        onRenameTargetChange={onNamespaceRenameTargetChange}
        onRenameNamespace={onRenameNamespace}
      />

      <GalleryEditModal
        isOpen={Boolean(editingImage)}
        editFolderSelect={editFolderSelect}
        editFolderOptions={editFolderOptions}
        newEditFolder={newEditFolder}
        editTags={editTags}
        onEditFolderSelect={onEditFolderSelect}
        onNewEditFolderChange={onNewEditFolderChange}
        onEditTagsChange={onEditTagsChange}
        onCancel={onEditCancel}
        onSave={onEditSave}
      />

      {deleteConfirmImageId && (
        <DeleteConfirmModal
          count={1}
          onConfirm={onDeleteConfirm}
          onCancel={onDeleteCancel}
          isDeleting={deleteConfirmDeleting}
        />
      )}

      {bulkEditOpen && (
        <GalleryBulkEditModal
          selectedCount={selectedCount}
          selectedImages={selectedImagesForPayload}
          animationPreviewImages={selectedAnimationPreview}
          bulkAnimateOrderMode={bulkAnimateOrderMode}
          onBulkAnimateOrderModeChange={onBulkAnimateOrderModeChange}
          bulkAnimateSelectionOrderDiffers={bulkAnimateSelectionOrderDiffers}
          onCopySelectionPayload={onCopySelectionPayload}
          bulkApplyFolder={bulkApplyFolder}
          onBulkApplyFolderChange={onBulkApplyFolderChange}
          bulkFolderMode={bulkFolderMode}
          bulkFolderInput={bulkFolderInput}
          onBulkFolderInputChange={onBulkFolderInputChange}
          bulkFolderOptions={bulkFolderOptions}
          onBulkFolderSelect={onBulkFolderSelect}
          bulkApplyTags={bulkApplyTags}
          onBulkApplyTagsChange={onBulkApplyTagsChange}
          bulkTagsMode={bulkTagsMode}
          onBulkTagsModeChange={onBulkTagsModeChange}
          bulkTagsInput={bulkTagsInput}
          onBulkTagsInputChange={onBulkTagsInputChange}
          bulkTagsAiCount={bulkTagsAiCount}
          onBulkTagsAiCountChange={onBulkTagsAiCountChange}
          bulkApplyDisplayName={bulkApplyDisplayName}
          onBulkApplyDisplayNameChange={onBulkApplyDisplayNameChange}
          bulkDisplayNameMode={bulkDisplayNameMode}
          onBulkDisplayNameModeChange={onBulkDisplayNameModeChange}
          bulkDisplayNameInput={bulkDisplayNameInput}
          onBulkDisplayNameInputChange={onBulkDisplayNameInputChange}
          bulkApplyDescription={bulkApplyDescription}
          onBulkApplyDescriptionChange={onBulkApplyDescriptionChange}
          bulkDescriptionAppendInput={bulkDescriptionAppendInput}
          onBulkDescriptionAppendInputChange={onBulkDescriptionAppendInputChange}
          bulkApplyNamespace={bulkApplyNamespace}
          onBulkApplyNamespaceChange={onBulkApplyNamespaceChange}
          bulkNamespaceInput={bulkNamespaceInput}
          onBulkNamespaceInputChange={onBulkNamespaceInputChange}
          registryNamespaces={registryNamespaces}
          onRegisterNamespace={onRegisterNamespace}
          bulkAnimateFps={bulkAnimateFps}
          onBulkAnimateFpsChange={onBulkAnimateFpsChange}
          bulkAnimateTouched={bulkAnimateTouched}
          onBulkAnimateTouchedChange={onBulkAnimateTouchedChange}
          bulkAnimateLoop={bulkAnimateLoop}
          onBulkAnimateLoopChange={onBulkAnimateLoopChange}
          bulkAnimateNamespaceInput={bulkAnimateNamespaceInput}
          onBulkAnimateNamespaceInputChange={onBulkAnimateNamespaceInputChange}
          bulkAnimateFilename={bulkAnimateFilename}
          onBulkAnimateFilenameChange={onBulkAnimateFilenameChange}
          bulkAnimateLoading={bulkAnimateLoading}
          bulkAnimateError={bulkAnimateError}
          bulkUpdating={bulkUpdating}
          onCreateAnimation={onBulkCreateAnimation}
          onApply={onBulkApply}
          onClose={onBulkClose}
        />
      )}
    </>
  );
};
