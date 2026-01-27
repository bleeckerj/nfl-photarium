/**
 * BulkEditModal Component
 * 
 * Modal for editing multiple selected images at once.
 * Manages its own form state internally and emits final values on apply.
 */

'use client';

import React, { useState, useEffect, CSSProperties } from 'react';
import MonoSelect from '@/components/MonoSelect';
import type { BulkFolderMode, BulkTagsMode, BulkDisplayNameMode } from '../types';

// Options to emit when user clicks Apply
export interface BulkEditOptions {
  applyFolder: boolean;
  folderMode: BulkFolderMode;
  folderInput: string;
  applyTags: boolean;
  tagsMode: BulkTagsMode;
  tagsInput: string;
  applyDisplayName: boolean;
  displayNameMode: BulkDisplayNameMode;
  displayNameInput: string;
  applyNamespace: boolean;
  namespaceInput: string;
}

export interface AnimationOptions {
  fps: number;
  loop: boolean;
  filename: string;
}

interface BulkEditModalProps {
  selectedCount: number;
  folders: string[];
  namespaceOptions?: { value: string; label: string }[];
  onApply: (options: BulkEditOptions) => Promise<void>;
  onClose: () => void;
  isUpdating?: boolean;
  // Animation
  onCreateAnimation?: (options: AnimationOptions) => Promise<void>;
  isAnimating?: boolean;
  animationError?: string | null;
}

export const BulkEditModal: React.FC<BulkEditModalProps> = ({
  selectedCount,
  folders,
  namespaceOptions = [],
  onApply,
  onClose,
  isUpdating = false,
  onCreateAnimation,
  isAnimating = false,
  animationError = null,
}) => {
  // Folder state
  const [applyFolder, setApplyFolder] = useState(false);
  const [folderMode, setFolderMode] = useState<BulkFolderMode>('existing');
  const [folderInput, setFolderInput] = useState('');

  // Tags state
  const [applyTags, setApplyTags] = useState(false);
  const [tagsMode, setTagsMode] = useState<BulkTagsMode>('replace');
  const [tagsInput, setTagsInput] = useState('');

  // Display name state
  const [applyDisplayName, setApplyDisplayName] = useState(false);
  const [displayNameMode, setDisplayNameMode] = useState<BulkDisplayNameMode>('custom');
  const [displayNameInput, setDisplayNameInput] = useState('');

  // Namespace state
  const [applyNamespace, setApplyNamespace] = useState(false);
  const [namespaceInput, setNamespaceInput] = useState('');

  // Animation state
  const [animateFps, setAnimateFps] = useState('2');
  const [animateLoop, setAnimateLoop] = useState(true);
  const [animateFilename, setAnimateFilename] = useState('');

  // Build folder options
  const folderOptions = [
    { value: '', label: '[none]' },
    ...folders.map((f) => ({ value: f, label: f })),
    { value: '__create__', label: 'Create new folder...' },
  ];

  // Handle folder selection
  const handleFolderSelect = (value: string) => {
    if (value === '__create__') {
      setFolderMode('new');
      setFolderInput('');
    } else {
      setFolderMode('existing');
      setFolderInput(value);
    }
  };

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isUpdating && !isAnimating) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, isUpdating, isAnimating]);

  // Submit handler
  const handleApply = async () => {
    await onApply({
      applyFolder,
      folderMode,
      folderInput,
      applyTags,
      tagsMode,
      tagsInput,
      applyDisplayName,
      displayNameMode,
      displayNameInput,
      applyNamespace,
      namespaceInput,
    });
  };

  // Animation handler
  const handleCreateAnimation = async () => {
    if (onCreateAnimation) {
      await onCreateAnimation({
        fps: parseFloat(animateFps) || 2,
        loop: animateLoop,
        filename: animateFilename || 'animated-webp',
      });
    }
  };

  const blurOverlayStyle: CSSProperties = {
    backdropFilter: 'blur(4px)',
    WebkitBackdropFilter: 'blur(4px)',
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-[60]"
        style={blurOverlayStyle}
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="fixed left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg w-full max-w-lg p-6 space-y-4 text-[0.7em] font-mono max-h-[90vh] overflow-y-auto z-[61]">
        <div className="flex items-center justify-between">
          <p className="text-gray-900 font-semibold">Bulk edit ({selectedCount} images)</p>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-lg">
            ×
          </button>
        </div>

        {/* Folder section */}
        <div className="space-y-3 border-b border-gray-100 pb-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={applyFolder}
              onChange={(e) => setApplyFolder(e.target.checked)}
              className="h-3 w-3"
            />
            <span className="font-medium">Update folder</span>
          </label>
          {applyFolder && (
            <div className="ml-5 space-y-2">
              {folderMode === 'existing' ? (
                <>
                  <MonoSelect
                    value={folderInput}
                    onChange={handleFolderSelect}
                    options={folderOptions}
                    className="w-full"
                    placeholder="[none]"
                    size="sm"
                  />
                  <p className="text-[0.85em] text-gray-500">
                    Choose an existing folder or pick &quot;Create new folder...&quot; to type a new name.
                  </p>
                </>
              ) : (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={folderInput}
                    onChange={(e) => setFolderInput(e.target.value)}
                    className="w-full border border-gray-300 rounded px-3 py-2"
                    placeholder="Type new folder name"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setFolderMode('existing')}
                    className="text-[0.85em] text-blue-600 hover:underline"
                  >
                    Back to folder list
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Tags section */}
        <div className="space-y-3 border-b border-gray-100 pb-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={applyTags}
              onChange={(e) => setApplyTags(e.target.checked)}
              className="h-3 w-3"
            />
            <span className="font-medium">Update tags</span>
          </label>
          {applyTags && (
            <div className="ml-5 space-y-2">
              <div className="flex items-center gap-4 text-gray-600">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="bulk-tags-mode"
                    checked={tagsMode === 'replace'}
                    onChange={() => setTagsMode('replace')}
                    className="h-3 w-3"
                  />
                  Replace
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="bulk-tags-mode"
                    checked={tagsMode === 'append'}
                    onChange={() => setTagsMode('append')}
                    className="h-3 w-3"
                  />
                  Append
                </label>
              </div>
              <textarea
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2"
                placeholder="Comma-separated tags"
                rows={2}
              />
              <p className="text-[0.85em] text-gray-500">
                {tagsMode === 'replace'
                  ? 'Replace tags with this list (empty clears tags).'
                  : 'Append tags to each image (empty keeps existing tags).'}
              </p>
            </div>
          )}
        </div>

        {/* Display name section */}
        <div className="space-y-3 border-b border-gray-100 pb-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={applyDisplayName}
              onChange={(e) => setApplyDisplayName(e.target.checked)}
              className="h-3 w-3"
            />
            <span className="font-medium">Update display name</span>
          </label>
          {applyDisplayName && (
            <div className="ml-5 space-y-2">
              <div className="flex flex-wrap items-center gap-4 text-gray-600">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="bulk-display-name-mode"
                    checked={displayNameMode === 'custom'}
                    onChange={() => setDisplayNameMode('custom')}
                    className="h-3 w-3"
                  />
                  Custom
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="bulk-display-name-mode"
                    checked={displayNameMode === 'auto'}
                    onChange={() => setDisplayNameMode('auto')}
                    className="h-3 w-3"
                  />
                  Auto (from filename)
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="bulk-display-name-mode"
                    checked={displayNameMode === 'clear'}
                    onChange={() => setDisplayNameMode('clear')}
                    className="h-3 w-3"
                  />
                  Clear
                </label>
              </div>
              {displayNameMode === 'custom' && (
                <input
                  type="text"
                  value={displayNameInput}
                  onChange={(e) => setDisplayNameInput(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2"
                  placeholder="Display name for all selected images"
                />
              )}
              <p className="text-[0.85em] text-gray-500">
                Auto mode uses the filename trimmed to 64 characters.
              </p>
            </div>
          )}
        </div>

        {/* Namespace section */}
        {namespaceOptions.length > 0 && (
          <div className="space-y-3 border-b border-gray-100 pb-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={applyNamespace}
                onChange={(e) => setApplyNamespace(e.target.checked)}
                className="h-3 w-3"
              />
              <span className="font-medium">Move to namespace</span>
            </label>
            {applyNamespace && (
              <div className="ml-5 space-y-2">
                <MonoSelect
                  value={namespaceInput}
                  onChange={setNamespaceInput}
                  options={[{ value: '', label: '[none]' }, ...namespaceOptions]}
                  className="w-full"
                  placeholder="[none]"
                  size="sm"
                />
                <p className="text-[0.85em] text-gray-500">
                  Move selected images to a different namespace. Empty clears the namespace.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Animation section */}
        {onCreateAnimation && selectedCount >= 2 && (
          <div className="space-y-3 border-b border-gray-100 pb-4">
            <p className="text-[0.85em] text-gray-500 uppercase tracking-wide font-medium">
              Create Animation
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-gray-600">
                FPS
                <input
                  type="number"
                  min="0.1"
                  step="0.5"
                  value={animateFps}
                  onChange={(e) => setAnimateFps(e.target.value)}
                  className="w-20 border border-gray-300 rounded px-2 py-1"
                />
              </label>
              <label className="flex items-center gap-2 text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={animateLoop}
                  onChange={(e) => setAnimateLoop(e.target.checked)}
                  className="h-3 w-3"
                />
                Loop
              </label>
              <label className="flex items-center gap-2 text-gray-600">
                Filename
                <input
                  type="text"
                  value={animateFilename}
                  onChange={(e) => setAnimateFilename(e.target.value)}
                  placeholder="animated-webp"
                  className="w-32 border border-gray-300 rounded px-2 py-1"
                />
              </label>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleCreateAnimation}
                disabled={isAnimating}
                className="px-3 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-50 transition"
              >
                {isAnimating ? 'Building...' : 'Create animated WebP'}
              </button>
              {animationError && (
                <p className="text-red-600">{animationError}</p>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50 transition"
            disabled={isUpdating}
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={isUpdating || (!applyFolder && !applyTags && !applyDisplayName && !applyNamespace)}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition"
          >
            {isUpdating ? 'Updating...' : 'Apply changes'}
          </button>
        </div>
      </div>
    </>
  );
};
