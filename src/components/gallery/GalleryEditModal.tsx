/**
 * GalleryEditModal Component
 * 
 * Edit image organization modal.
 */

'use client';

import React from 'react';
import MonoSelect from '../MonoSelect';
import type { SelectOption } from './types';

interface GalleryEditModalProps {
  isOpen: boolean;
  editFolderSelect: string;
  editFolderOptions: SelectOption[];
  newEditFolder: string;
  editTags: string;
  onEditFolderSelect: (value: string) => void;
  onNewEditFolderChange: (value: string) => void;
  onEditTagsChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}

export const GalleryEditModal: React.FC<GalleryEditModalProps> = ({
  isOpen,
  editFolderSelect,
  editFolderOptions,
  newEditFolder,
  editTags,
  onEditFolderSelect,
  onNewEditFolderChange,
  onEditTagsChange,
  onCancel,
  onSave,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4">
        <h3 className="text-lg font-medium text-gray-900 mb-4">
          Edit Image Organization
        </h3>
        
        <div id="gallery-results-list" className="space-y-4">
          <div>
            <label htmlFor="edit-folder" className="block text-[0.7em] font-mono font-mono font-medum text-gray-700 mb-1">
              Folder
            </label>
            <div>
              <MonoSelect
                id="edit-folder"
                value={editFolderSelect}
                onChange={onEditFolderSelect}
                options={editFolderOptions}
                className="w-full"
                size="sm"
              />
              {editFolderSelect === '__create__' && (
                <input
                  value={newEditFolder}
                  onChange={(e) => onNewEditFolderChange(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-[0.9em] font-mono mt-2"
                  placeholder="Type new folder name"
                />
              )}
            </div>
            <p className="text-[0.7em] font-mono text-gray-500 mt-1">Select existing folder or create a new one</p>
          </div>
          
          <div>
            <label htmlFor="edit-tags" className="block text-[0.7em] font-mono font-mono font-medum text-gray-700 mb-1">
              Tags
            </label>
            <input
              id="edit-tags"
              type="text"
              placeholder="logo, header, banner (comma separated)"
              value={editTags}
              onChange={(e) => onEditTagsChange(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-[0.7em] font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-[0.7em] font-mono text-gray-500 mt-1">Separate tags with commas</p>
          </div>
        </div>
        
        <div className="flex justify-end space-x-3 mt-6">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-[0.7em] font-mono text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            className="px-4 py-2 text-[0.7em] font-mono bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
};
