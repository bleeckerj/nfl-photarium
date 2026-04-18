import { Cpu, Settings } from 'lucide-react';
import type { ReactNode } from 'react';
import DateNavigator from '@/components/DateNavigator';
import MonoSelect from '@/components/MonoSelect';
import type { DateFilter, GridSize } from './types';
import { GridSizeToggle } from './GridSizeToggle';

export type LegacyTopBarImage = { id: string; uploaded: string };

interface LegacyTopBarProps {
  filteredCount: number;
  totalCount: number;
  namespaceLabel?: string;
  namespace?: string;
  showPagination: boolean;
  currentPageRangeLabel: string | null;
  sortedImages: LegacyTopBarImage[];
  dateFilter: DateFilter | null;
  onDateFilterChange: (filter: DateFilter | null) => void;
  bulkSelectionMode: boolean;
  filtersCollapsed: boolean;
  hasActiveFilters: boolean;
  pageSize: number;
  pageSizeOptions: number[];
  defaultPageSize: number;
  gridSize: GridSize;
  refreshingCache: boolean;
  viewMode: 'grid' | 'list';
  selectedCount: number;
  bulkEmbeddingGenerating: boolean;
  bulkDeleting: boolean;
  onToggleBulkSelection: () => void;
  onToggleFilters: () => void;
  onClearFilters: () => void;
  onPageSizeChange: (size: number) => void;
  onGridSizeChange: (size: GridSize) => void;
  onRefreshCache: () => void;
  onOpenNamespaceSettings: () => void;
  onToggleViewMode: () => void;
  onSelectPage: () => void;
  onClearSelection: () => void;
  onOpenBulkEdit: () => void;
  onGenerateEmbeddings: () => void;
  onDeleteSelected: () => void;
  backupControls?: ReactNode;
}

export default function LegacyTopBar({
  filteredCount,
  totalCount,
  namespaceLabel,
  namespace,
  showPagination,
  currentPageRangeLabel,
  sortedImages,
  dateFilter,
  onDateFilterChange,
  bulkSelectionMode,
  filtersCollapsed,
  hasActiveFilters,
  pageSize,
  pageSizeOptions,
  defaultPageSize,
  gridSize,
  refreshingCache,
  viewMode,
  selectedCount,
  bulkEmbeddingGenerating,
  bulkDeleting,
  onToggleBulkSelection,
  onToggleFilters,
  onClearFilters,
  onPageSizeChange,
  onGridSizeChange,
  onRefreshCache,
  onOpenNamespaceSettings,
  onToggleViewMode,
  onSelectPage,
  onClearSelection,
  onOpenBulkEdit,
  onGenerateEmbeddings,
  onDeleteSelected,
  backupControls,
}: LegacyTopBarProps) {
  return (
    <div className="flex flex-col gap-3 mb-4">
      <div id="first-row-controls" className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-[0.7em] font-mono text-gray-900">
            Image Gallery ({filteredCount}/{totalCount})
          </p>
          {namespace && (
            <p className="font-mono text-[0.7em] text-gray-500">Namespace: {namespaceLabel}</p>
          )}
          {showPagination && currentPageRangeLabel && (
            <p className="font-mono text-[0.7em] text-gray-500">
              Showing uploads from {currentPageRangeLabel}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 text-[0.7em] font-mono text-gray-600">
          <DateNavigator
            allImages={sortedImages}
            currentFilter={dateFilter}
            onFilterChange={onDateFilterChange}
          />
        </div>
      </div>

      <div id="second-row-controls" className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onToggleBulkSelection}
            className="px-3 py-1 text-[0.7em] font-mono border border-gray-200 rounded-md hover:bg-gray-100 transition"
            aria-pressed={bulkSelectionMode}
          >
            {bulkSelectionMode ? 'Done selecting' : 'Select images'}
          </button>
          <button
            onClick={onToggleFilters}
            className="px-3 py-1 text-[0.7em] font-mono border border-gray-200 rounded-md hover:bg-gray-100 transition"
            aria-pressed={!filtersCollapsed}
          >
            {filtersCollapsed ? 'Show filters' : 'Hide filters'}
          </button>
          <button
            onClick={onClearFilters}
            disabled={!hasActiveFilters}
            className="px-3 py-1 text-[0.7em] font-mono border border-gray-200 rounded-md hover:bg-gray-100 transition disabled:opacity-50"
          >
            Clear filters
          </button>
          {backupControls}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-gray-100/50 rounded-md px-2 py-0.5">
            <label htmlFor="page-size-toolbar" className="text-[0.65rem] font-mono text-gray-500 whitespace-nowrap">
              Gallery Size:
            </label>
            <MonoSelect
              id="page-size-toolbar"
              value={String(pageSize)}
              onChange={(nextValue) => {
                const parsed = Number(nextValue);
                onPageSizeChange(Number.isFinite(parsed) ? parsed : defaultPageSize);
              }}
              options={pageSizeOptions.map((size) => ({ value: String(size), label: String(size) }))}
              className="w-18"
              size="sm"
            />
          </div>
          <GridSizeToggle value={gridSize} onChange={onGridSizeChange} />
          <button
            onClick={onRefreshCache}
            disabled={refreshingCache}
            className="px-3 py-1 text-[0.7em] font-mono border border-gray-200 rounded-md hover:bg-gray-100 transition disabled:opacity-50"
            title="Refresh the server-side Cloudflare cache"
          >
            {refreshingCache ? 'Refreshing…' : 'Refresh cache'}
          </button>
          <button
            onClick={onOpenNamespaceSettings}
            className="px-3 py-1 text-[0.7em] font-mono border border-gray-200 rounded-md hover:bg-gray-100 transition flex items-center gap-2"
            title="Namespace settings"
          >
            <Settings className="h-3 w-3" />
            Namespace
          </button>
          <button
            onClick={onToggleViewMode}
            className="px-3 py-1 text-[0.7em] font-mono bg-gray-100 hover:bg-gray-200 rounded-md"
          >
            {viewMode === 'grid' ? '📋 List' : '🔲 Grid'}
          </button>
        </div>
      </div>

      {(bulkSelectionMode || selectedCount > 0) && (
        <div className="mb-4 flex flex-wrap items-center gap-3 text-[0.7em] font-mono text-gray-700">
          <span>{selectedCount} selected</span>
          <button
            onClick={onSelectPage}
            className="px-2 py-1 border rounded-md hover:bg-gray-100"
          >
            Select page
          </button>
          <button
            onClick={onClearSelection}
            className="px-2 py-1 border rounded-md hover:bg-gray-100"
          >
            Clear
          </button>
          <button
            onClick={onOpenBulkEdit}
            className="px-2 py-1 bg-gray-900 text-white rounded-md hover:bg-black disabled:opacity-40"
            disabled={!selectedCount}
          >
            Bulk edit
          </button>
          <button
            onClick={onGenerateEmbeddings}
            className="px-2 py-1 border border-green-300 text-green-700 rounded-md hover:bg-green-50 disabled:opacity-40 inline-flex items-center gap-1"
            disabled={!selectedCount || bulkEmbeddingGenerating}
            title="Generate CLIP and color embeddings for selected images"
          >
            <Cpu className="h-3 w-3" />
            {bulkEmbeddingGenerating ? 'Generating…' : 'Embeddings'}
          </button>
          <button
            onClick={onDeleteSelected}
            className="px-2 py-1 border border-red-300 text-red-700 rounded-md hover:bg-red-50 disabled:opacity-40"
            disabled={!selectedCount || bulkDeleting}
          >
            {bulkDeleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      )}
    </div>
  );
}
