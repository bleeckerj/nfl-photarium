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

  bulkEditOpen: boolean;
  selectedCount: number;
  bulkApplyFolder: boolean;
  onBulkApplyFolderChange: (value: boolean) => void;
  bulkFolderMode: 'existing' | 'new';
  bulkFolderInput: string;
  onBulkFolderInputChange: (value: string) => void;
  bulkFolderOptions: SelectOption[];
  onBulkFolderSelect: (value: string) => void;
  bulkApplyTags: boolean;
  onBulkApplyTagsChange: (value: boolean) => void;
  bulkTagsMode: 'replace' | 'append';
  onBulkTagsModeChange: (value: 'replace' | 'append') => void;
  bulkTagsInput: string;
  onBulkTagsInputChange: (value: string) => void;
  bulkApplyDisplayName: boolean;
  onBulkApplyDisplayNameChange: (value: boolean) => void;
  bulkDisplayNameMode: 'custom' | 'auto' | 'clear';
  onBulkDisplayNameModeChange: (value: 'custom' | 'auto' | 'clear') => void;
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
  bulkAnimateFps: string;
  onBulkAnimateFpsChange: (value: string) => void;
  bulkAnimateTouched: boolean;
  onBulkAnimateTouchedChange: (value: boolean) => void;
  bulkAnimateLoop: boolean;
  onBulkAnimateLoopChange: (value: boolean) => void;
  bulkAnimateFilename: string;
  onBulkAnimateFilenameChange: (value: string) => void;
  bulkAnimateLoading: boolean;
  bulkAnimateError: string | null;
  bulkUpdating: boolean;
  onBulkApply: () => void;
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
  bulkEditOpen,
  selectedCount,
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
  bulkAnimateFps,
  onBulkAnimateFpsChange,
  bulkAnimateTouched,
  onBulkAnimateTouchedChange,
  bulkAnimateLoop,
  onBulkAnimateLoopChange,
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

      {bulkEditOpen && (
        <GalleryBulkEditModal
          selectedCount={selectedCount}
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
          bulkAnimateFps={bulkAnimateFps}
          onBulkAnimateFpsChange={onBulkAnimateFpsChange}
          bulkAnimateTouched={bulkAnimateTouched}
          onBulkAnimateTouchedChange={onBulkAnimateTouchedChange}
          bulkAnimateLoop={bulkAnimateLoop}
          onBulkAnimateLoopChange={onBulkAnimateLoopChange}
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
