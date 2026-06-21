/**
 * GalleryNamespaceModal Component
 * 
 * Namespace settings modal.
 */

'use client';

import React from 'react';
import MonoSelect from '../MonoSelect';
import type { SelectOption } from './types';

interface GalleryNamespaceModalProps {
  isOpen: boolean;
  namespaceSelectValue: string;
  namespaceDraft: string;
  namespaceOptions: SelectOption[];
  onSelectChange: (value: string) => void;
  onDraftChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
  selectedNamespaceForDelete?: string;
  canDeleteSelectedNamespace?: boolean;
  deletingNamespace?: boolean;
  onDeleteNamespace?: () => void;
  namespaceRenameTarget?: string;
  canRenameSelectedNamespace?: boolean;
  renamingNamespace?: boolean;
  onRenameTargetChange?: (value: string) => void;
  onRenameNamespace?: () => void;
}

export const GalleryNamespaceModal: React.FC<GalleryNamespaceModalProps> = ({
  isOpen,
  namespaceSelectValue,
  namespaceDraft,
  namespaceOptions,
  onSelectChange,
  onDraftChange,
  onCancel,
  onSave,
  selectedNamespaceForDelete,
  canDeleteSelectedNamespace = false,
  deletingNamespace = false,
  onDeleteNamespace,
  namespaceRenameTarget = '',
  canRenameSelectedNamespace = false,
  renamingNamespace = false,
  onRenameTargetChange,
  onRenameNamespace,
}) => {
  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 z-[100000]"
        onClick={onCancel}
      />
      <div className="fixed left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 w-80 bg-white rounded-lg shadow-xl z-[100001] text-[0.75em] font-mono text-gray-800 border">
        <div className="flex items-center justify-between p-3 border-b">
          <div className="text-[0.8em] font-mono font-medium">Namespace</div>
          <button
            onClick={onCancel}
            className="px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded text-[0.75em] font-mono"
            title="Close"
          >
            ×
          </button>
        </div>
        <div className="p-3 space-y-3">
          <label className="block text-[0.75em] text-gray-600">
            Namespace
            <div className="mt-1 space-y-2">
              <MonoSelect
                id="namespace-select"
                value={namespaceSelectValue}
                onChange={onSelectChange}
                options={namespaceOptions}
                className="w-full"
                size="sm"
              />
              <input
                value={namespaceDraft}
                onChange={(e) => onDraftChange(e.target.value)}
                placeholder="Custom namespace (optional)"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-[0.85em] focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={namespaceSelectValue !== '__custom__'}
              />
            </div>
          </label>
          <p className="text-[0.7em] text-gray-500">
            Only images in this namespace are shown and used for duplicate checks (unless you pick &quot;All namespaces&quot;).
          </p>
          {selectedNamespaceForDelete && !canDeleteSelectedNamespace ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
              <div className="text-[0.75em] font-medium text-amber-800">Protected namespace</div>
              <p className="mt-1 text-[0.7em] text-amber-700">
                &quot;{selectedNamespaceForDelete}&quot; is a system namespace and cannot be renamed or deleted.
              </p>
            </div>
          ) : null}
          {selectedNamespaceForDelete && canDeleteSelectedNamespace ? (
            <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
              <div className="text-[0.75em] font-medium text-gray-800">Rename namespace</div>
              <p className="mt-1 text-[0.7em] text-gray-600">
                Moves every asset in &quot;{selectedNamespaceForDelete}&quot; to the new namespace name.
              </p>
              <input
                value={namespaceRenameTarget}
                onChange={(e) => onRenameTargetChange?.(e.target.value)}
                placeholder="New namespace name"
                className="mt-2 w-full border border-gray-300 rounded-md px-3 py-2 text-[0.85em] focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={!canDeleteSelectedNamespace || renamingNamespace}
              />
              <button
                type="button"
                onClick={onRenameNamespace}
                disabled={!canRenameSelectedNamespace || renamingNamespace}
                className="mt-2 px-3 py-1 border border-gray-300 rounded-md bg-white text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {renamingNamespace ? 'Renaming...' : 'Rename namespace'}
              </button>
            </div>
          ) : null}
          {selectedNamespaceForDelete && canDeleteSelectedNamespace ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3">
              <div className="text-[0.75em] font-medium text-red-800">Delete namespace</div>
              <p className="mt-1 text-[0.7em] text-red-700">
                Moves all assets in &quot;{selectedNamespaceForDelete}&quot; to cf-default, then removes this namespace.
              </p>
              <button
                type="button"
                onClick={onDeleteNamespace}
                disabled={!canDeleteSelectedNamespace || deletingNamespace}
                className="mt-2 px-3 py-1 border border-red-300 rounded-md bg-white text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deletingNamespace ? 'Deleting...' : 'Delete namespace'}
              </button>
            </div>
          ) : null}
        </div>
        <div className="flex items-center justify-end gap-2 p-3 border-t">
          <button
            onClick={onCancel}
            className="px-3 py-1 border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            className="px-3 py-1 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Save
          </button>
        </div>
      </div>
    </>
  );
};
