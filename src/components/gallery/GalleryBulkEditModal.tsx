/**
 * GalleryBulkEditModal Component
 * 
 * Bulk edit modal UI extracted from ImageGallery.
 */

'use client';

import React, { useMemo, useState } from 'react';
import MonoSelect from '../MonoSelect';
import { getCloudflareImageUrl } from '@/utils/imageUtils';

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
        <div className="space-y-3">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={bulkApplyDescription}
              onChange={(e) => onBulkApplyDescriptionChange(e.target.checked)}
              className="h-3 w-3"
            />
            Append to description
          </label>
          {bulkApplyDescription && (
            <div className="space-y-2">
              <textarea
                value={bulkDescriptionAppendInput}
                onChange={(e) => onBulkDescriptionAppendInputChange(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2"
                placeholder="Text to append to each selected image description"
                rows={3}
              />
              <p className="text-[0.6rem] text-gray-500">
                Appends text to existing descriptions with a blank line separator.
              </p>
            </div>
          )}
        </div>
        <div className="space-y-3">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={bulkApplyFolder}
              onChange={(e) => onBulkApplyFolderChange(e.target.checked)}
              className="h-3 w-3"
            />
            Update folder
          </label>
          {bulkApplyFolder && (
            <div className="space-y-2">
              {bulkFolderMode === 'existing' ? (
                <>
                  <MonoSelect
                    value={bulkFolderInput}
                    onChange={onBulkFolderSelect}
                    options={bulkFolderOptions}
                    className="w-full"
                    placeholder="[none]"
                    size="sm"
                  />
                  <p className="text-[0.6rem] text-gray-500">
                    Choose an existing folder or pick “Create new folder…” to type a new name.
                  </p>
                </>
              ) : (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={bulkFolderInput}
                    onChange={(e) => onBulkFolderInputChange(e.target.value)}
                    className="w-full border border-gray-300 rounded px-3 py-2"
                    placeholder="Type new folder name"
                  />
                  <button
                    type="button"
                    onClick={() => onBulkFolderSelect('')}
                    className="text-[0.6rem] text-blue-600 underline"
                  >
                    ← Back to folder list
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="space-y-3">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={bulkApplyTags}
              onChange={(e) => onBulkApplyTagsChange(e.target.checked)}
              className="h-3 w-3"
            />
            Update tags
          </label>
          {bulkApplyTags && (
            <div className="space-y-2">
              <div className="flex items-center gap-4 text-[0.65rem] text-gray-600">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="bulk-tags-mode"
                    checked={bulkTagsMode === 'replace'}
                    onChange={() => onBulkTagsModeChange('replace')}
                    className="h-3 w-3"
                  />
                  Replace
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="bulk-tags-mode"
                    checked={bulkTagsMode === 'append'}
                    onChange={() => onBulkTagsModeChange('append')}
                    className="h-3 w-3"
                  />
                  Append
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="bulk-tags-mode"
                    checked={bulkTagsMode === 'ai'}
                    onChange={() => onBulkTagsModeChange('ai')}
                    className="h-3 w-3"
                  />
                  Append (GenAI)
                </label>
              </div>
              {bulkTagsMode === 'ai' ? (
                <label className="block text-[0.65rem] text-gray-600">
                  Tags per image
                  <input
                    type="number"
                    min="1"
                    max="12"
                    value={bulkTagsAiCount}
                    onChange={(e) => onBulkTagsAiCountChange(e.target.value)}
                    className="mt-1 w-24 border border-gray-300 rounded px-3 py-2"
                  />
                </label>
              ) : (
                <textarea
                  value={bulkTagsInput}
                  onChange={(e) => onBulkTagsInputChange(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2"
                  placeholder="Comma-separated tags"
                  rows={3}
                />
              )}
              <p className="text-[0.6rem] text-gray-500">
                {bulkTagsMode === 'replace'
                  ? 'Replace tags with this list (empty clears tags).'
                  : bulkTagsMode === 'append'
                    ? 'Append tags to each image (empty keeps existing tags).'
                    : 'Generate semantic tags for each selected image and append only new tags.'}
              </p>
            </div>
          )}
        </div>
        <div className="space-y-3">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={bulkApplyDisplayName}
              onChange={(e) => onBulkApplyDisplayNameChange(e.target.checked)}
              className="h-3 w-3"
            />
            Update display name
          </label>
          {bulkApplyDisplayName && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-4 text-[0.65rem] text-gray-600">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="bulk-display-name-mode"
                    checked={bulkDisplayNameMode === 'custom'}
                    onChange={() => onBulkDisplayNameModeChange('custom')}
                    className="h-3 w-3"
                  />
                  Custom
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="bulk-display-name-mode"
                    checked={bulkDisplayNameMode === 'auto'}
                    onChange={() => onBulkDisplayNameModeChange('auto')}
                    className="h-3 w-3"
                  />
                  Auto (trim filename)
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="bulk-display-name-mode"
                    checked={bulkDisplayNameMode === 'ai'}
                    onChange={() => onBulkDisplayNameModeChange('ai')}
                    className="h-3 w-3"
                  />
                  AI (generate)
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="bulk-display-name-mode"
                    checked={bulkDisplayNameMode === 'clear'}
                    onChange={() => onBulkDisplayNameModeChange('clear')}
                    className="h-3 w-3"
                  />
                  Clear
                </label>
              </div>
              {bulkDisplayNameMode === 'custom' && (
                <input
                  type="text"
                  value={bulkDisplayNameInput}
                  onChange={(e) => onBulkDisplayNameInputChange(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2"
                  placeholder="Display name"
                />
              )}
              <p className="text-[0.6rem] text-gray-500">
                Auto mode uses the filename trimmed to 64 characters. AI mode generates a short name per image.
              </p>
            </div>
          )}
        </div>
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
        <div className="space-y-2 border-t border-gray-200 pt-3">
          <p className="text-[0.65rem] text-gray-500 uppercase tracking-wide">Animate selection</p>
          <div className="space-y-2">
            <div className="inline-flex overflow-hidden rounded border border-gray-300 text-[0.65rem]">
              <button
                type="button"
                onClick={() => onBulkAnimateOrderModeChange('gallery')}
                className={`px-2 py-1 ${
                  bulkAnimateOrderMode === 'gallery'
                    ? 'bg-gray-900 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                Gallery order
              </button>
              <button
                type="button"
                onClick={() => onBulkAnimateOrderModeChange('reverse-gallery')}
                className={`border-l border-gray-300 px-2 py-1 ${
                  bulkAnimateOrderMode === 'reverse-gallery'
                    ? 'bg-gray-900 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                Reverse gallery
              </button>
            </div>
            {bulkAnimateSelectionOrderDiffers && (
              <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[0.65rem] text-amber-800">
                Manual click order differs from gallery order. This animation will follow the order shown below.
              </p>
            )}
            {animationPreviewImages.length > 0 && (
              <div className="flex gap-2 overflow-x-auto rounded border border-gray-200 bg-gray-50 p-2">
                {animationPreviewImages.map((image, index) => {
                  let previewUrl = '';
                  try {
                    previewUrl = getCloudflareImageUrl(image.id, 'w=150');
                  } catch {
                    previewUrl = '';
                  }
                  return (
                    <div key={image.id} className="w-24 shrink-0 space-y-1">
                      <div className="relative aspect-square overflow-hidden rounded border border-gray-200 bg-white">
                        {previewUrl ? (
                          <img src={previewUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[0.6rem] text-gray-400">
                            no preview
                          </div>
                        )}
                        <span className="absolute left-1 top-1 rounded bg-black/70 px-1 py-0.5 text-[0.6rem] text-white">
                          {index + 1}
                        </span>
                      </div>
                      <p className="truncate text-[0.6rem] text-gray-700" title={image.filename}>
                        {image.filename}
                      </p>
                      {(index === 0 || index === animationPreviewImages.length - 1) && (
                        <p className="text-[0.55rem] uppercase tracking-wide text-gray-500">
                          {index === 0 ? 'first frame' : 'last frame'}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-[0.65rem] text-gray-600">
              FPS
              <input
                type="number"
                min="0.1"
                step="0.5"
                value={bulkAnimateFps}
                onChange={(e) => {
                  onBulkAnimateTouchedChange(true);
                  onBulkAnimateFpsChange(e.target.value);
                }}
                className="w-20 border border-gray-300 rounded px-2 py-1"
              />
            </label>
            <label className="flex items-center gap-2 text-[0.65rem] text-gray-600">
              Loop
              <input
                type="checkbox"
                checked={bulkAnimateLoop}
                onChange={(e) => onBulkAnimateLoopChange(e.target.checked)}
                className="h-3 w-3"
              />
            </label>
            <label className="flex items-center gap-2 text-[0.65rem] text-gray-600">
              Output namespace
              <MonoSelect
                value={bulkAnimateNamespaceInput}
                onChange={onBulkAnimateNamespaceInputChange}
                options={animationNamespaceOptions}
                className="w-48"
                size="sm"
              />
            </label>
            <label className="flex items-center gap-2 text-[0.65rem] text-gray-600">
              Output name
              <input
                type="text"
                value={bulkAnimateFilename}
                onChange={(e) => onBulkAnimateFilenameChange(e.target.value)}
                placeholder="animated-webp"
                className="w-40 border border-gray-300 rounded px-2 py-1"
              />
            </label>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onCreateAnimation}
              disabled={bulkAnimateLoading || selectedCount < 2}
              className="px-3 py-2 bg-emerald-600 text-white rounded-md disabled:opacity-50"
            >
              {bulkAnimateLoading ? 'Building…' : 'Create animated WebP'}
            </button>
            {bulkAnimateError && <p className="text-[0.65rem] text-red-600">{bulkAnimateError}</p>}
          </div>
        </div>
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
