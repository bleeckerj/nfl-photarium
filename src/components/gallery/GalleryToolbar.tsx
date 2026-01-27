/**
 * GalleryToolbar Component
 * 
 * Top toolbar with pagination, view mode toggle, variant selector, and namespace settings.
 */

'use client';

import React from 'react';
import MonoSelect from '@/components/MonoSelect';
import { VARIANT_OPTIONS, PAGE_SIZE_OPTIONS } from './constants';
import type { ViewMode, NamespaceInfo } from './types';

interface GalleryToolbarProps {
  // View
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  
  // Variant
  selectedVariant: string;
  onVariantChange: (variant: string) => void;
  
  // Pagination
  currentPage: number;
  totalPages: number;
  pageSize: number;
  totalImages: number;
  filteredCount: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  dateRangeLabel?: string;
  
  // Namespace
  namespaceOptions: { value: string; label: string }[];
  activeNamespace: string;
  onNamespaceChange: (namespace: string) => void;
  onOpenNamespaceSettings: () => void;
  
  // Actions
  onRefresh: () => void;
  isRefreshing?: boolean;
  
  // Bulk selection
  bulkSelectionMode?: boolean;
  selectedCount?: number;
  onToggleBulkMode?: () => void;
  onSelectAll?: () => void;
  onDeselectAll?: () => void;
  onOpenBulkEdit?: () => void;
  onDeleteSelected?: () => void;
}

export const GalleryToolbar: React.FC<GalleryToolbarProps> = ({
  viewMode,
  onViewModeChange,
  selectedVariant,
  onVariantChange,
  currentPage,
  totalPages,
  pageSize,
  totalImages,
  filteredCount,
  onPageChange,
  onPageSizeChange,
  dateRangeLabel,
  namespaceOptions,
  activeNamespace,
  onNamespaceChange,
  onOpenNamespaceSettings,
  onRefresh,
  isRefreshing = false,
  bulkSelectionMode = false,
  selectedCount = 0,
  onToggleBulkMode,
  onSelectAll,
  onDeselectAll,
  onOpenBulkEdit,
  onDeleteSelected,
}) => {
  // Build page options
  const pageOptions = Array.from({ length: totalPages }, (_, i) => ({
    value: String(i + 1),
    label: `Page ${i + 1}`,
  }));

  const pageSizeSelectOptions = PAGE_SIZE_OPTIONS.map((size) => ({
    value: String(size),
    label: `${size} per page`,
  }));

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-gray-50 border-b">
      {/* Left section: Info and controls */}
      <div className="flex items-center gap-3">
        {/* Image count */}
        <div className="text-[0.7em] font-mono text-gray-600">
          {filteredCount === totalImages ? (
            <span>{totalImages.toLocaleString()} images</span>
          ) : (
            <span>
              {filteredCount.toLocaleString()} of {totalImages.toLocaleString()} images
            </span>
          )}
          {dateRangeLabel && (
            <span className="ml-2 text-gray-400">• {dateRangeLabel}</span>
          )}
        </div>

        {/* Refresh button */}
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="px-2 py-1 text-[0.7em] font-mono bg-white border rounded hover:bg-gray-100 disabled:opacity-50 transition"
          title="Refresh gallery"
        >
          {isRefreshing ? '⟳' : '↻'} Refresh
        </button>

        {/* Namespace selector */}
        {namespaceOptions.length > 0 && (
          <div className="flex items-center gap-1">
            <MonoSelect
              options={namespaceOptions}
              value={activeNamespace}
              onChange={onNamespaceChange}
              className="text-[0.7em]"
            />
            <button
              onClick={onOpenNamespaceSettings}
              className="px-1.5 py-1 text-[0.7em] font-mono bg-white border rounded hover:bg-gray-100 transition"
              title="Namespace settings"
            >
              ⚙
            </button>
          </div>
        )}
      </div>

      {/* Center section: Pagination */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onPageChange(1)}
          disabled={currentPage === 1}
          className="px-2 py-1 text-[0.7em] font-mono bg-white border rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
          title="First page"
        >
          ««
        </button>
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="px-2 py-1 text-[0.7em] font-mono bg-white border rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
          title="Previous page"
        >
          «
        </button>
        
        <MonoSelect
          options={pageOptions}
          value={String(currentPage)}
          onChange={(val) => onPageChange(Number(val))}
          className="text-[0.7em] w-24"
        />
        
        <span className="text-[0.7em] font-mono text-gray-500">
          of {totalPages}
        </span>
        
        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="px-2 py-1 text-[0.7em] font-mono bg-white border rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
          title="Next page"
        >
          »
        </button>
        <button
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage === totalPages}
          className="px-2 py-1 text-[0.7em] font-mono bg-white border rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
          title="Last page"
        >
          »»
        </button>

        <MonoSelect
          options={pageSizeSelectOptions}
          value={String(pageSize)}
          onChange={(val) => onPageSizeChange(Number(val))}
          className="text-[0.7em] w-28"
        />
      </div>

      {/* Right section: View controls */}
      <div className="flex items-center gap-3">
        {/* Bulk selection controls */}
        {onToggleBulkMode && (
          <div className="flex items-center gap-2">
            <button
              onClick={onToggleBulkMode}
              className={`px-2 py-1 text-[0.7em] font-mono border rounded transition ${
                bulkSelectionMode
                  ? 'bg-blue-100 border-blue-300 text-blue-700'
                  : 'bg-white hover:bg-gray-100'
              }`}
              title="Toggle bulk selection mode"
            >
              ☑ Bulk
            </button>
            
            {bulkSelectionMode && (
              <>
                <span className="text-[0.7em] font-mono text-gray-600">
                  {selectedCount} selected
                </span>
                {onSelectAll && (
                  <button
                    onClick={onSelectAll}
                    className="px-2 py-1 text-[0.7em] font-mono bg-white border rounded hover:bg-gray-100 transition"
                  >
                    Select All
                  </button>
                )}
                {onDeselectAll && selectedCount > 0 && (
                  <button
                    onClick={onDeselectAll}
                    className="px-2 py-1 text-[0.7em] font-mono bg-white border rounded hover:bg-gray-100 transition"
                  >
                    Deselect
                  </button>
                )}
                {onOpenBulkEdit && selectedCount > 0 && (
                  <button
                    onClick={onOpenBulkEdit}
                    className="px-2 py-1 text-[0.7em] font-mono bg-blue-100 border border-blue-300 rounded hover:bg-blue-200 transition"
                  >
                    Edit
                  </button>
                )}
                {onDeleteSelected && selectedCount > 0 && (
                  <button
                    onClick={onDeleteSelected}
                    className="px-2 py-1 text-[0.7em] font-mono bg-red-100 border border-red-300 text-red-700 rounded hover:bg-red-200 transition"
                  >
                    Delete
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {/* Variant selector */}
        <MonoSelect
          options={VARIANT_OPTIONS}
          value={selectedVariant}
          onChange={onVariantChange}
          className="text-[0.7em] w-28"
        />

        {/* View mode toggle */}
        <div className="flex items-center border rounded overflow-hidden">
          <button
            onClick={() => onViewModeChange('grid')}
            className={`px-2 py-1 text-[0.7em] font-mono transition ${
              viewMode === 'grid'
                ? 'bg-gray-200 text-gray-800'
                : 'bg-white text-gray-500 hover:bg-gray-100'
            }`}
            title="Grid view"
          >
            ▦
          </button>
          <button
            onClick={() => onViewModeChange('list')}
            className={`px-2 py-1 text-[0.7em] font-mono transition ${
              viewMode === 'list'
                ? 'bg-gray-200 text-gray-800'
                : 'bg-white text-gray-500 hover:bg-gray-100'
            }`}
            title="List view"
          >
            ≡
          </button>
        </div>
      </div>
    </div>
  );
};
