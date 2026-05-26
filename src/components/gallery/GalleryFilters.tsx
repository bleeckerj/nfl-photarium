/**
 * GalleryFilters Component
 * 
 * Search, folder filter, tag filter, and various toggles for filtering the gallery.
 * Note: Date filtering is handled separately via the DateNavigator component.
 */

'use client';

import React, { useState } from 'react';
import MonoSelect from '@/components/MonoSelect';
import type { AspectRatioClass } from './types';

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
  
  // Aspect ratio filters
  aspectRatioFilters: AspectRatioClass[];
  onAspectRatioFiltersChange: (filters: AspectRatioClass[]) => void;

  // Checkboxes
  showDuplicatesOnly: boolean;
  onShowDuplicatesOnlyChange: (value: boolean) => void;
  showVariationsOnly: boolean;
  onShowVariationsOnlyChange: (value: boolean) => void;
  showMotionAssetsOnly: boolean;
  onShowMotionAssetsOnlyChange: (value: boolean) => void;
  showFavoritesOnly?: boolean;
  onShowFavoritesOnlyChange?: (value: boolean) => void;
  showOnlyMissingEmbeddings: boolean;
  onShowOnlyMissingEmbeddingsChange: (value: boolean) => void;
  onlyCanonical: boolean;
  onOnlyCanonicalChange: (value: boolean) => void;
  respectAspectRatio: boolean;
  onRespectAspectRatioChange: (value: boolean) => void;
  showBrokenOnly: boolean;
  onShowBrokenOnlyChange: (value: boolean) => void;
  showComfyOnly: boolean;
  onShowComfyOnlyChange: (value: boolean) => void;
  
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
  aspectRatioFilters,
  onAspectRatioFiltersChange,
  showDuplicatesOnly,
  onShowDuplicatesOnlyChange,
  showVariationsOnly,
  onShowVariationsOnlyChange,
  showMotionAssetsOnly,
  onShowMotionAssetsOnlyChange,
  showFavoritesOnly = false,
  onShowFavoritesOnlyChange,
  showOnlyMissingEmbeddings,
  onShowOnlyMissingEmbeddingsChange,
  onlyCanonical,
  onOnlyCanonicalChange,
  respectAspectRatio,
  onRespectAspectRatioChange,
  showBrokenOnly,
  onShowBrokenOnlyChange,
  showComfyOnly,
  onShowComfyOnlyChange,
  onClearFilters,
  hasActiveFilters,
}) => {
  const [showFolderDropdown, setShowFolderDropdown] = useState(false);
  const [showTagDropdown, setShowTagDropdown] = useState(false);

  // Build folder options for the select
  const folderOptions = [
    { value: 'all', label: 'All Folders' },
    ...folders.map((f) => ({
      value: f,
      label: hiddenFolders.has(f) ? `${f || '(root)'} (hidden)` : f || '(root)',
    })),
  ];

  // Build tag options for the select
  const tagOptions = [
    { value: '', label: 'All Tags' },
    ...allTags
      .filter((t) => !hiddenTags.has(t.toLowerCase()))
      .map((t) => ({ value: t, label: t })),
  ];

  const toggleAspectFilter = (value: AspectRatioClass) => {
    if (aspectRatioFilters.includes(value)) {
      onAspectRatioFiltersChange(aspectRatioFilters.filter(item => item !== value));
    } else {
      onAspectRatioFiltersChange([...aspectRatioFilters, value]);
    }
  };

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
        <div className="relative flex items-center">
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
            ≡
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
        <div className="relative flex items-center">
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
            ≡
          </button>
          
          {/* Tag visibility dropdown */}
          {showTagDropdown && (
            <div className="absolute top-full left-0 mt-1 w-64 bg-white border rounded shadow-lg z-[5000] max-h-60 overflow-y-auto">
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
                       checked={!hiddenTags.has(tag.toLowerCase())}
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

        {/* Aspect ratio toggles */}
        <div className="flex items-center gap-1">
          <span className="text-[0.7em] font-mono text-gray-500 mr-1">Aspect</span>
          <button
            type="button"
            onClick={() => toggleAspectFilter('square')}
            aria-pressed={aspectRatioFilters.includes('square')}
            className={`h-6 w-6 border rounded flex items-center justify-center ${
              aspectRatioFilters.includes('square')
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
            }`}
            title="Square"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <rect x="1" y="1" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => toggleAspectFilter('horizontal')}
            aria-pressed={aspectRatioFilters.includes('horizontal')}
            className={`h-6 w-6 border rounded flex items-center justify-center ${
              aspectRatioFilters.includes('horizontal')
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
            }`}
            title="Horizontal"
          >
            <svg width="12" height="8" viewBox="0 0 12 8" aria-hidden="true">
              <rect x="1" y="1" width="10" height="6" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => toggleAspectFilter('vertical')}
            aria-pressed={aspectRatioFilters.includes('vertical')}
            className={`h-6 w-6 border rounded flex items-center justify-center ${
              aspectRatioFilters.includes('vertical')
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
            }`}
            title="Vertical"
          >
            <svg width="8" height="12" viewBox="0 0 8 12" aria-hidden="true">
              <rect x="1" y="1" width="6" height="10" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
          </button>
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
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={onlyCanonical}
            onChange={(e) => onOnlyCanonicalChange(e.target.checked)}
            className="rounded"
          />
          <span className="text-[0.65em] font-mono text-gray-700">
            Canonical Only
          </span>
        </label>

        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={respectAspectRatio}
            onChange={(e) => onRespectAspectRatioChange(e.target.checked)}
            className="rounded"
          />
          <span className="text-[0.65em] font-mono text-gray-700">
            Respect Aspect Ratio
          </span>
        </label>

        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={showFavoritesOnly}
            onChange={(e) => onShowFavoritesOnlyChange?.(e.target.checked)}
            className="rounded"
          />
          <span className="text-[0.65em] font-mono text-gray-700">
            Favorites Only
          </span>
        </label>

        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={showDuplicatesOnly}
            onChange={(e) => onShowDuplicatesOnlyChange(e.target.checked)}
            className="rounded"
          />
          <span className="text-[0.65em] font-mono text-gray-700">
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
          <span className="text-[0.65em] font-mono text-gray-700">
            Parents With Variants
          </span>
        </label>

        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={showMotionAssetsOnly}
            onChange={(e) => onShowMotionAssetsOnlyChange(e.target.checked)}
            className="rounded"
          />
          <span className="text-[0.65em] font-mono text-gray-700">
            Motion Assets Only
          </span>
        </label>

        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={showOnlyMissingEmbeddings}
            onChange={(e) => onShowOnlyMissingEmbeddingsChange(e.target.checked)}
            className="rounded"
          />
          <span className="text-[0.65em] font-mono text-gray-700">
            Missing Embeddings
          </span>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={showBrokenOnly}
            onChange={(e) => onShowBrokenOnlyChange(e.target.checked)}
            className="rounded"
          />
          <span className="text-[0.65em] font-mono text-gray-700">
            Broken Only
          </span>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={showComfyOnly}
            onChange={(e) => onShowComfyOnlyChange(e.target.checked)}
            className="rounded"
          />
          <span className="text-[0.65em] font-mono text-gray-700">
            Comfy Only
          </span>
        </label>
      </div>
    </div>
  );
};
