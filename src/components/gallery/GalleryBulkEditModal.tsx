/**
 * GalleryBulkEditModal Component
 * 
 * Bulk edit modal UI extracted from ImageGallery.
 */

'use client';

import React from 'react';
import MonoSelect from '../MonoSelect';

interface SelectOption {
  value: string;
  label: string;
}

interface GalleryBulkEditModalProps {
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
  onCreateAnimation: () => void;
  onApply: () => void;
  onClose: () => void;
}

export const GalleryBulkEditModal: React.FC<GalleryBulkEditModalProps> = ({
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
  onCreateAnimation,
  onApply,
  onClose,
}) => {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[9999] px-4">
      <div className="bg-white rounded-lg w-full max-w-lg p-6 space-y-4 text-[0.7em] font-mono">
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
              </div>
              <textarea
                value={bulkTagsInput}
                onChange={(e) => onBulkTagsInputChange(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2"
                placeholder="Comma-separated tags"
                rows={3}
              />
              <p className="text-[0.6rem] text-gray-500">
                {bulkTagsMode === 'replace'
                  ? 'Replace tags with this list (empty clears tags).'
                  : 'Append tags to each image (empty keeps existing tags).'}
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
              <MonoSelect
                value={bulkNamespaceInput}
                onChange={onBulkNamespaceInputChange}
                options={[
                  { value: '', label: '[none]' },
                  ...registryNamespaces.map(ns => ({ value: ns, label: ns }))
                ]}
                className="w-full"
                placeholder="[none]"
                size="sm"
              />
              <p className="text-[0.6rem] text-gray-500">
                Move selected images to a different namespace. Empty clears the namespace.
              </p>
            </div>
          )}
        </div>
        <div className="space-y-2 border-t border-gray-200 pt-3">
          <p className="text-[0.65rem] text-gray-500 uppercase tracking-wide">Animate selection</p>
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
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-md"
            disabled={bulkUpdating}
          >
            Cancel
          </button>
          <button
            onClick={onApply}
            disabled={bulkUpdating}
            className="px-4 py-2 bg-blue-600 text-white rounded-md disabled:opacity-50"
          >
            {bulkUpdating ? 'Updating…' : 'Apply changes'}
          </button>
        </div>
      </div>
    </div>
  );
};
