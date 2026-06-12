import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { GalleryModals } from '@/components/gallery/GalleryModals';

const renderGalleryModals = (overrides: Partial<React.ComponentProps<typeof GalleryModals>> = {}) => {
  const props: React.ComponentProps<typeof GalleryModals> = {
    images: [],
    openCopyMenu: null,
    onCloseCopyMenu: vi.fn(),
    getVariantUrls: () => ({}),
    getVariantWidthLabel: () => null,
    onCopyUrl: vi.fn(),
    onDownload: vi.fn(),
    namespaceModalOpen: false,
    namespaceSelectValue: '',
    namespaceDraft: '',
    namespaceOptions: [],
    onNamespaceSelectChange: vi.fn(),
    onNamespaceDraftChange: vi.fn(),
    onNamespaceCancel: vi.fn(),
    onNamespaceSave: vi.fn(),
    editingImage: null,
    editFolderSelect: '',
    editFolderOptions: [],
    newEditFolder: '',
    editTags: '',
    onEditFolderSelect: vi.fn(),
    onNewEditFolderChange: vi.fn(),
    onEditTagsChange: vi.fn(),
    onEditCancel: vi.fn(),
    onEditSave: vi.fn(),
    deleteConfirmImageId: null,
    deleteConfirmDeleting: false,
    onDeleteConfirm: vi.fn(),
    onDeleteCancel: vi.fn(),
    bulkEditOpen: false,
    selectedCount: 0,
    selectedImagesForPayload: [],
    selectedAnimationPreview: [],
    bulkAnimateOrderMode: 'gallery',
    onBulkAnimateOrderModeChange: vi.fn(),
    bulkAnimateSelectionOrderDiffers: false,
    onCopySelectionPayload: vi.fn(),
    bulkApplyFolder: false,
    onBulkApplyFolderChange: vi.fn(),
    bulkFolderMode: 'existing',
    bulkFolderInput: '',
    onBulkFolderInputChange: vi.fn(),
    bulkFolderOptions: [],
    onBulkFolderSelect: vi.fn(),
    bulkApplyTags: false,
    onBulkApplyTagsChange: vi.fn(),
    bulkTagsMode: 'append',
    onBulkTagsModeChange: vi.fn(),
    bulkTagsInput: '',
    onBulkTagsInputChange: vi.fn(),
    bulkTagsAiCount: '5',
    onBulkTagsAiCountChange: vi.fn(),
    bulkApplyDisplayName: false,
    onBulkApplyDisplayNameChange: vi.fn(),
    bulkDisplayNameMode: 'custom',
    onBulkDisplayNameModeChange: vi.fn(),
    bulkDisplayNameInput: '',
    onBulkDisplayNameInputChange: vi.fn(),
    bulkApplyDescription: false,
    onBulkApplyDescriptionChange: vi.fn(),
    bulkDescriptionAppendInput: '',
    onBulkDescriptionAppendInputChange: vi.fn(),
    bulkApplyNamespace: false,
    onBulkApplyNamespaceChange: vi.fn(),
    bulkNamespaceInput: '',
    onBulkNamespaceInputChange: vi.fn(),
    registryNamespaces: [],
    onRegisterNamespace: vi.fn(),
    bulkAnimateFps: '12',
    onBulkAnimateFpsChange: vi.fn(),
    bulkAnimateTouched: false,
    onBulkAnimateTouchedChange: vi.fn(),
    bulkAnimateLoop: true,
    onBulkAnimateLoopChange: vi.fn(),
    bulkAnimateFilename: '',
    onBulkAnimateFilenameChange: vi.fn(),
    bulkAnimateLoading: false,
    bulkAnimateError: null,
    bulkUpdating: false,
    onBulkApply: vi.fn(),
    onBulkCreateAnimation: vi.fn(),
    onBulkClose: vi.fn(),
    ...overrides,
  };

  return renderToStaticMarkup(React.createElement(GalleryModals, props));
};

describe('GalleryModals', () => {
  it('renders the delete confirmation modal when an image is pending delete', () => {
    const markup = renderGalleryModals({ deleteConfirmImageId: 'img-1' });

    expect(markup).toContain('Confirm Deletion');
    expect(markup).toContain('Delete Image');
  });
});
