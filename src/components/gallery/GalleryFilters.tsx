/**
 * GalleryFilters Component
 * 
 * Search, folder filter, tag filter, and various toggles for filtering the gallery.
 * Note: Date filtering is handled separately via the DateNavigator component.
 */

'use client';

import React, { useState } from 'react';
import MonoSelect from '@/components/MonoSelect';

interface GalleryFiltersProps {
  // Search
  searchTerm: string;
  onSearchChange: (term: string) => void;
  
  // Folder filter
  folders: string[];
  selectedFolder: string;
  onFolderChange: (folder: string) => void;
  hiddenFolders: Set<string>;
  onToggleHiddenFolder: (folder: string) => void;
  onShowAllFolders: () => void;
  
  // Tag filter
  allTags: string[];
  selectedTag: string;
  onTagChange: (tag: string) => void;
  hiddenTags: Set<string>;
  onToggleHiddenTag: (tag: string) => void;
  onShowAllTags: () => void;
  
  // Checkboxes
  showDuplicatesOnly: boolean;
  onShowDuplicatesOnlyChange: (value: boolean) => void;
  showVariationsOnly: boolean;
  onShowVariationsOnlyChange: (value: boolean) => void;
  showOnlyMissingEmbeddings: boolean;
  onShowOnlyMissingEmbeddingsChange: (value: boolean) => void;
  
  // Clear all
  onClearFilters: () => void;
  hasActiveFilters: boolean;
}

export const GalleryFilters: React.FC<GalleryFiltersProps> = ({
  searchTerm,
  onSearchChange,
  folders,
  selectedFolder,
  onFolderChange,
  hiddenFolders,
  onToggleHiddenFolder,
  onShowAllFolders,
  allTags,
  selectedTag,
  onTagChange,
  hiddenTags,
  onToggleHiddenTag,
  onShowAllTags,
  showDuplicatesOnly,
  onShowDuplicatesOnlyChange,
  showVariationsOnly,
  onShowVariationsOnlyChange,
  showOnlyMissingEmbeddings,
  onShowOnlyMissingEmbeddingsChange,
  onClearFilters,
  hasActiveFilters,
}) => {
  const [showFolderDropdown, setShowFolderDropdown] = useState(false);
  const [showTagDropdown, setShowTagDropdown] = useState(false);

  // Build folder options for the select
  const folderOptions = [
    { value: '', label: 'All Folders' },
    ...folders
      .filter((f) => !hiddenFolders.has(f))
      .map((f) => ({ value: f, label: f || '(root)' })),
  ];

  // Build tag options for the select
  const tagOptions = [
    { value: '', label: 'All Tags' },
    ...allTags
      .filter((t) => !hiddenTags.has(t))
      .map((t) => ({ value: t, label: t })),
  ];

  return (
    <div className="p-3 bg-white border-b space-y-3">
      {/* Row 1: Search and primary filters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search input */}
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search by filename, alt text, or tags..."
            className="w-full px-3 py-1.5 pr-8 text-[0.7em] font-mono border rounded focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
          {searchTerm && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              title="Clear search"
            >
              ×
            </button>
          )}
        </div>

        {/* Folder filter */}
        <div className="relative">
          <MonoSelect
            options={folderOptions}
            value={selectedFolder}
            onChange={onFolderChange}
            className="text-[0.7em] w-40"
          />
          <button
            onClick={() => setShowFolderDropdown(!showFolderDropdown)}
            className="ml-1 px-1.5 py-1 text-[0.7em] font-mono bg-white border rounded hover:bg-gray-100 transition"
            title="Manage hidden folders"
          >
            👁
          </button>
          
          {/* Folder visibility dropdown */}
          {showFolderDropdown && (
            <div className="absolute top-full left-0 mt-1 w-64 bg-white border rounded shadow-lg z-50 max-h-60 overflow-y-auto">
              <div className="p-2 border-b bg-gray-50 flex items-center justify-between">
                <span className="text-[0.7em] font-mono font-medium">Hidden Folders</span>
                <button
                  onClick={() => {
                    onShowAllFolders();
                    setShowFolderDropdown(false);
                  }}
                  className="text-[0.7em] font-mono text-blue-600 hover:underline"
                >
                  Show All
                </button>
              </div>
              <div className="p-2 space-y-1">
                {folders.map((folder) => (
                  <label
                    key={folder}
                    className="flex items-center gap-2 px-2 py-1 hover:bg-gray-50 rounded cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={!hiddenFolders.has(folder)}
                      onChange={() => onToggleHiddenFolder(folder)}
                      className="rounded"
                    />
                    <span className="text-[0.7em] font-mono text-gray-700">
                      {folder || '(root)'}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Tag filter */}
        <div className="relative">
          <MonoSelect
            options={tagOptions}
            value={selectedTag}
            onChange={onTagChange}
            className="text-[0.7em] w-36"
          />
          <button
            onClick={() => setShowTagDropdown(!showTagDropdown)}
            className="ml-1 px-1.5 py-1 text-[0.7em] font-mono bg-white border rounded hover:bg-gray-100 transition"
            title="Manage hidden tags"
          >
            👁
          </button>
          
          {/* Tag visibility dropdown */}
          {showTagDropdown && (
            <div className="absolute top-full left-0 mt-1 w-64 bg-white border rounded shadow-lg z-50 max-h-60 overflow-y-auto">
              <div className="p-2 border-b bg-gray-50 flex items-center justify-between">
                <span className="text-[0.7em] font-mono font-medium">Hidden Tags</span>
                <button
                  onClick={() => {
                    onShowAllTags();
                    setShowTagDropdown(false);
                  }}
                  className="text-[0.7em] font-mono text-blue-600 hover:underline"
                >
                  Show All
                </button>
              </div>
              <div className="p-2 space-y-1">
                {allTags.map((tag) => (
                  <label
                    key={tag}
                    className="flex items-center gap-2 px-2 py-1 hover:bg-gray-50 rounded cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={!hiddenTags.has(tag)}
                      onChange={() => onToggleHiddenTag(tag)}
                      className="rounded"
                    />
                    <span className="text-[0.7em] font-mono text-gray-700">{tag}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Clear filters button */}
        {hasActiveFilters && (
          <button
            onClick={onClearFilters}
            className="px-2 py-1 text-[0.7em] font-mono bg-yellow-100 border border-yellow-300 text-yellow-800 rounded hover:bg-yellow-200 transition"
          >
            Clear Filters
          </button>
        )}
      </div>

      {/* Row 2: Toggle checkboxes */}
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={showDuplicatesOnly}
            onChange={(e) => onShowDuplicatesOnlyChange(e.target.checked)}
            className="rounded"
          />
          <span className="text-[0.7em] font-mono text-gray-700">
            Duplicates Only
          </span>
        </label>

        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={showVariationsOnly}
            onChange={(e) => onShowVariationsOnlyChange(e.target.checked)}
            className="rounded"
          />
          <span className="text-[0.7em] font-mono text-gray-700">
            Variations Only
          </span>
        </label>

        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={showOnlyMissingEmbeddings}
            onChange={(e) => onShowOnlyMissingEmbeddingsChange(e.target.checked)}
            className="rounded"
          />
          <span className="text-[0.7em] font-mono text-gray-700">
            Missing Embeddings
          </span>
        </label>
      </div>
    </div>
  );
};
