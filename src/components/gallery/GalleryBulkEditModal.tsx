/**
 * GalleryBulkEditModal Component
 * 
 * Bulk edit modal UI extracted from ImageGallery.
 */

'use client';

import React, { useMemo, useState } from 'react';
import MonoSelect from '../MonoSelect';
import { getCloudflareImageUrl } from '@/utils/imageUtils';
import { BulkEditMetadataSections } from '@/features/gallery/BulkEditMetadataSections';
import { BulkAnimateSection } from '@/features/gallery/BulkAnimateSection';

interface SelectOption {
  value: string;
  label: string;
}

interface GalleryBulkEditModalProps {
  selectedCount: number;
  selectedImages: Array<{
    id: string;
    filename: string;
    altText?: string;
    altTag?: string;
  }>;
  animationPreviewImages: Array<{
    id: string;
    filename: string;
    altText?: string;
    altTag?: string;
  }>;
  bulkAnimateOrderMode: 'gallery' | 'reverse-gallery';
  onBulkAnimateOrderModeChange: (value: 'gallery' | 'reverse-gallery') => void;
  bulkAnimateSelectionOrderDiffers: boolean;
  onCopySelectionPayload: (payload: string, label?: string) => void | Promise<void>;
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
  onCreateAnimation: () => void;
  onApply: (options?: { namespaceOverride?: string }) => void | Promise<void>;
  onClose: () => void;
}

export const GalleryBulkEditModal: React.FC<GalleryBulkEditModalProps> = ({
  selectedCount,
  selectedImages,
  animationPreviewImages,
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
  onCreateAnimation,
  onApply,
  onClose,
}) => {
  const sizeOptions = useMemo(
    () => [
      { value: 'w=150', label: '150px' },
      { value: 'w=300', label: '300px' },
      { value: 'w=600', label: '600px' },
      { value: 'w=900', label: '900px' },
      { value: 'w=1200', label: '1200px' },
      { value: 'full', label: 'full' },
      { value: 'public', label: 'public' },
    ],
    []
  );
  const [selectionSize, setSelectionSize] = useState('w=900');
  const [sharedAltText, setSharedAltText] = useState('');
  const [copyingSelectionPayload, setCopyingSelectionPayload] = useState(false);
  const [copyingSelectionIds, setCopyingSelectionIds] = useState<'csv' | 'json' | null>(null);
  const [creatingNamespace, setCreatingNamespace] = useState(false);
  const [namespaceNameInput, setNamespaceNameInput] = useState('');
  const [namespaceDescriptionInput, setNamespaceDescriptionInput] = useState('');
  const [namespaceError, setNamespaceError] = useState<string | null>(null);
  const [registeringNamespace, setRegisteringNamespace] = useState(false);

  const buildSelectionPayload = () => {
    const normalizedSharedAltText = sharedAltText.trim();
    const payload = selectedImages.map((image) => {
      let url = '';
      try {
        url = getCloudflareImageUrl(image.id, selectionSize);
      } catch {
        url = '';
      }
      return {
        url,
        altText: normalizedSharedAltText || image.altText || image.altTag || '',
      };
    });
    return JSON.stringify(payload, null, 2);
  };

  const payloadPreview = useMemo(() => {
    const normalizedSharedAltText = sharedAltText.trim();
    const previewItems = selectedImages.slice(0, 3).map((image) => {
      let url = '';
      try {
        url = getCloudflareImageUrl(image.id, selectionSize);
      } catch {
        url = '';
      }
      return {
        url,
        altText: normalizedSharedAltText || image.altText || image.altTag || '',
      };
    });
    return JSON.stringify(previewItems, null, 2);
  }, [selectedImages, selectionSize, sharedAltText]);

  const namespaceOptions = useMemo(
    () => registryNamespaces.map(ns => ({ value: ns, label: ns })),
    [registryNamespaces]
  );
  const animationNamespaceOptions = useMemo(
    () => [
      { value: '', label: 'Same as selected images' },
      ...namespaceOptions,
    ],
    [namespaceOptions]
  );

  const handleCopySelectionPayload = async () => {
    setCopyingSelectionPayload(true);
    try {
      await onCopySelectionPayload(buildSelectionPayload());
    } finally {
      setCopyingSelectionPayload(false);
    }
  };

  const selectionIdsCsv = useMemo(
    () => selectedImages.map((image) => image.id).join(','),
    [selectedImages]
  );
  const selectionIdsJson = useMemo(
    () => JSON.stringify(selectedImages.map((image) => image.id), null, 2),
    [selectedImages]
  );

  const handleCopySelectionIds = async (format: 'csv' | 'json') => {
    setCopyingSelectionIds(format);
    try {
      await onCopySelectionPayload(
        format === 'csv' ? selectionIdsCsv : selectionIdsJson,
        format === 'csv' ? 'Selection IDs CSV' : 'Selection IDs JSON'
      );
    } finally {
      setCopyingSelectionIds(null);
    }
  };

  const handleApply = async () => {
    setNamespaceError(null);
    if (!bulkApplyNamespace) {
      await onApply();
      return;
    }

    if (creatingNamespace) {
      const namespaceName = namespaceNameInput.trim();
      if (!namespaceName || namespaceName === '__all__' || namespaceName === '__none__') {
        setNamespaceError('Enter a non-empty namespace name.');
        return;
      }

      setRegisteringNamespace(true);
      try {
        const registered = await onRegisterNamespace(namespaceName, namespaceDescriptionInput);
        if (!registered) {
          setNamespaceError('Could not create namespace.');
          return;
        }
        onBulkNamespaceInputChange(namespaceName);
        await onApply({ namespaceOverride: namespaceName });
      } finally {
        setRegisteringNamespace(false);
      }
      return;
    }

    if (!bulkNamespaceInput.trim()) {
      setNamespaceError('Choose a namespace before applying.');
      return;
    }
    await onApply();
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[9999] px-4">
      <div className="bg-white rounded-lg w-full max-w-2xl p-6 space-y-4 text-[0.7em] font-mono max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <p className="text-gray-900 font-semibold">Bulk edit ({selectedCount} images)</p>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            ×
          </button>
        </div>
        <BulkEditMetadataSections
          bulkApplyDescription={bulkApplyDescription}
          onBulkApplyDescriptionChange={onBulkApplyDescriptionChange}
          bulkDescriptionAppendInput={bulkDescriptionAppendInput}
          onBulkDescriptionAppendInputChange={onBulkDescriptionAppendInputChange}
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
        />
        <div className="space-y-3">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={bulkApplyNamespace}
              onChange={(e) => onBulkApplyNamespaceChange(e.target.checked)}
              className="h-3 w-3"
            />
            Move to namespace
          </label>
          {bulkApplyNamespace && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-3 text-[0.6rem]">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="bulk-namespace-mode"
                    checked={!creatingNamespace}
                    onChange={() => setCreatingNamespace(false)}
                    className="h-3 w-3"
                  />
                  Existing
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="bulk-namespace-mode"
                    checked={creatingNamespace}
                    onChange={() => setCreatingNamespace(true)}
                    className="h-3 w-3"
                  />
                  Create new
                </label>
              </div>
              {creatingNamespace ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={namespaceNameInput}
                    onChange={(e) => setNamespaceNameInput(e.target.value)}
                    className="w-full border border-gray-300 rounded px-3 py-2"
                    placeholder="Namespace name"
                  />
                  <textarea
                    value={namespaceDescriptionInput}
                    onChange={(e) => setNamespaceDescriptionInput(e.target.value)}
                    className="w-full border border-gray-300 rounded px-3 py-2"
                    placeholder="Namespace description (optional)"
                    rows={3}
                  />
                </div>
              ) : (
                <MonoSelect
                  value={bulkNamespaceInput}
                  onChange={onBulkNamespaceInputChange}
                  options={namespaceOptions}
                  className="w-full"
                  placeholder="Choose namespace"
                  size="sm"
                />
              )}
              {namespaceError && (
                <p className="text-[0.6rem] text-red-600">{namespaceError}</p>
              )}
              <p className="text-[0.6rem] text-gray-500">
                Move selected images to a selected or newly created namespace.
              </p>
            </div>
          )}
        </div>
        <BulkAnimateSection
          selectedCount={selectedCount}
          animationPreviewImages={animationPreviewImages}
          bulkAnimateOrderMode={bulkAnimateOrderMode}
          onBulkAnimateOrderModeChange={onBulkAnimateOrderModeChange}
          bulkAnimateSelectionOrderDiffers={bulkAnimateSelectionOrderDiffers}
          bulkAnimateFps={bulkAnimateFps}
          onBulkAnimateFpsChange={onBulkAnimateFpsChange}
          onBulkAnimateTouchedChange={onBulkAnimateTouchedChange}
          bulkAnimateLoop={bulkAnimateLoop}
          onBulkAnimateLoopChange={onBulkAnimateLoopChange}
          bulkAnimateNamespaceInput={bulkAnimateNamespaceInput}
          onBulkAnimateNamespaceInputChange={onBulkAnimateNamespaceInputChange}
          animationNamespaceOptions={animationNamespaceOptions}
          bulkAnimateFilename={bulkAnimateFilename}
          onBulkAnimateFilenameChange={onBulkAnimateFilenameChange}
          bulkAnimateLoading={bulkAnimateLoading}
          bulkAnimateError={bulkAnimateError}
          onCreateAnimation={onCreateAnimation}
        />
        <div className="space-y-3 border-t border-gray-200 pt-3">
          <p className="text-[0.65rem] text-gray-500 uppercase tracking-wide">Selection JSON</p>
          <label className="block text-[0.65rem] text-gray-600">
            Shared ALT text (optional override)
            <input
              type="text"
              value={sharedAltText}
              onChange={(e) => setSharedAltText(e.target.value)}
              className="mt-1 w-full border border-gray-300 rounded px-2 py-1"
              placeholder="If empty, each image uses its own alt text"
            />
          </label>
          <label className="block text-[0.65rem] text-gray-600">
            Size (applies to all selected images)
            <div className="mt-1">
              <MonoSelect
                value={selectionSize}
                onChange={setSelectionSize}
                options={sizeOptions}
                size="sm"
              />
            </div>
          </label>
          <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2">
            <p className="text-[0.62rem] text-gray-700">
              Will copy {selectedImages.length} item{selectedImages.length === 1 ? '' : 's'} as a JSON array.
            </p>
            <p className="mt-1 text-[0.58rem] text-gray-500">Preview (first up to 3 items):</p>
            <pre className="mt-1 max-h-40 overflow-auto text-[0.55rem] text-gray-600 whitespace-pre-wrap break-all">
              {payloadPreview}
            </pre>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleCopySelectionPayload}
              disabled={copyingSelectionPayload || selectedImages.length === 0}
              className="px-3 py-2 bg-slate-800 text-white rounded-md disabled:opacity-50"
            >
              {copyingSelectionPayload ? 'Copying…' : 'Copy JSON array'}
            </button>
          </div>
        </div>
        <div className="space-y-3 border-t border-gray-200 pt-3">
          <p className="text-[0.65rem] text-gray-500 uppercase tracking-wide">Selection IDs</p>
          <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 space-y-2">
            <div>
              <p className="text-[0.58rem] text-gray-500">CSV</p>
              <pre className="mt-1 max-h-24 overflow-auto text-[0.55rem] text-gray-600 whitespace-pre-wrap break-all">
                {selectionIdsCsv}
              </pre>
            </div>
            <div>
              <p className="text-[0.58rem] text-gray-500">JSON array</p>
              <pre className="mt-1 max-h-24 overflow-auto text-[0.55rem] text-gray-600 whitespace-pre-wrap break-all">
                {selectionIdsJson}
              </pre>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => handleCopySelectionIds('csv')}
              disabled={copyingSelectionIds !== null || selectedImages.length === 0}
              className="px-3 py-2 bg-slate-800 text-white rounded-md disabled:opacity-50"
            >
              {copyingSelectionIds === 'csv' ? 'Copying…' : 'Copy IDs as CSV'}
            </button>
            <button
              type="button"
              onClick={() => handleCopySelectionIds('json')}
              disabled={copyingSelectionIds !== null || selectedImages.length === 0}
              className="px-3 py-2 bg-slate-800 text-white rounded-md disabled:opacity-50"
            >
              {copyingSelectionIds === 'json' ? 'Copying…' : 'Copy IDs as JSON'}
            </button>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-md"
            disabled={bulkUpdating || registeringNamespace}
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={bulkUpdating || registeringNamespace}
            className="px-4 py-2 bg-blue-600 text-white rounded-md disabled:opacity-50"
          >
            {bulkUpdating || registeringNamespace ? 'Updating…' : 'Apply changes'}
          </button>
        </div>
      </div>
    </div>
  );
};
