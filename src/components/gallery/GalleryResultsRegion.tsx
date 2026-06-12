import { AlertTriangle } from 'lucide-react';

import FolderManagerButton from '@/components/FolderManagerButton';
import MonoSelect from '@/components/MonoSelect';
import { GalleryGridView } from '@/components/gallery/GalleryGridView';
import { GalleryListView } from '@/components/gallery/GalleryListView';
import type {
  AuditProgress,
  BrokenAudit,
  CloudflareImage,
  GalleryViewFilters,
  GridSize,
  SelectOption,
} from '@/components/gallery/types';

interface GalleryResultsRegionProps {
  hasResults: boolean;
  galleryTotalCount: number;
  colorSearchHex: string | null;
  hasActiveFilters: boolean;
  viewMode: 'grid' | 'list';
  gridSize: GridSize;
  viewFilters: GalleryViewFilters;
  selectedVariant: string;
  variantOptions: SelectOption[];
  namespace?: string;
  auditLoading: boolean;
  auditProgress: AuditProgress;
  brokenAudit: BrokenAudit;
  onClearFilters: () => void;
  onToggleSelection: (id: string) => void;
  onBeforeNavigate: (imageId: string) => void;
  onCopyNamespace: (namespace: string) => void;
  onSelectColor: (hex: string) => void;
  onToggleCopyMenu: (id: string) => void;
  onStartEdit: (image: CloudflareImage) => void;
  onDelete: (imageId: string) => void;
  onToggleFavorite: (imageId: string) => Promise<void>;
  onGenerateAlt: (imageId: string) => Promise<void>;
  onGenerateDisplayName: (imageId: string) => Promise<void>;
  onDragStart: (event: React.DragEvent, image: CloudflareImage) => void;
  onMouseEnter: (imageId: string, event: React.MouseEvent) => void;
  onMouseMove: (imageId: string, event: React.MouseEvent) => void;
  onMouseLeave: () => void;
  onVariantChange: (variant: string) => void;
  onFoldersChanged: () => Promise<void>;
  onRunBrokenAudit: () => void;
}

export default function GalleryResultsRegion({
  hasResults,
  galleryTotalCount,
  colorSearchHex,
  hasActiveFilters,
  viewMode,
  gridSize,
  viewFilters,
  selectedVariant,
  variantOptions,
  namespace,
  auditLoading,
  auditProgress,
  brokenAudit,
  onClearFilters,
  onToggleSelection,
  onBeforeNavigate,
  onCopyNamespace,
  onSelectColor,
  onToggleCopyMenu,
  onStartEdit,
  onDelete,
  onToggleFavorite,
  onGenerateAlt,
  onGenerateDisplayName,
  onDragStart,
  onMouseEnter,
  onMouseMove,
  onMouseLeave,
  onVariantChange,
  onFoldersChanged,
  onRunBrokenAudit,
}: GalleryResultsRegionProps) {
  return (
    <>
      {!hasResults ? (
        <div id="gallery-empty-state" className="text-center py-12">
          <div className="text-gray-400 mb-2">
            <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 20 20" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <p className="text-gray-500">
            {galleryTotalCount === 0 ? 'No images uploaded yet' : 'No images match your filters'}
          </p>
          <p className="text-[0.7em] font-mono text-gray-400">
            {galleryTotalCount === 0
              ? 'Upload some images to see them here'
              : colorSearchHex
                ? 'Try a different swatch or clear the active color search'
                : 'Try adjusting your search or filters'}
          </p>
          {galleryTotalCount > 0 && (hasActiveFilters || Boolean(colorSearchHex)) && (
            <button
              onClick={onClearFilters}
              className="mt-3 px-3 py-1 text-[0.7em] font-mono border border-gray-200 rounded-md hover:bg-gray-100 transition"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : viewMode === 'grid' ? (
        <GalleryGridView
          gridSize={gridSize}
          filters={viewFilters}
          onToggleSelection={onToggleSelection}
          onBeforeNavigate={onBeforeNavigate}
          onCopyNamespace={onCopyNamespace}
          onSelectColor={onSelectColor}
          onToggleCopyMenu={onToggleCopyMenu}
          onStartEdit={onStartEdit}
          onDelete={onDelete}
          onToggleFavorite={onToggleFavorite}
          onMouseEnter={onMouseEnter}
          onMouseMove={onMouseMove}
          onMouseLeave={onMouseLeave}
        />
      ) : (
        <GalleryListView
          filters={viewFilters}
          onToggleSelection={onToggleSelection}
          onStartEdit={onStartEdit}
          onDelete={onDelete}
          onGenerateAlt={onGenerateAlt}
          onGenerateDisplayName={onGenerateDisplayName}
          onToggleFavorite={onToggleFavorite}
          onCopyUrl={onToggleCopyMenu}
          onCopyNamespace={onCopyNamespace}
          onSelectColor={onSelectColor}
          onBeforeNavigate={onBeforeNavigate}
          onDragStart={onDragStart}
          onMouseEnter={onMouseEnter}
          onMouseMove={onMouseMove}
          onMouseLeave={onMouseLeave}
        />
      )}

      <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex-1 min-w-[200px]">
          <label htmlFor="variant-select" className="block text-[0.7em] font-mono font-medum text-gray-700 mb-1">
            Image Size
          </label>
          <MonoSelect
            id="variant-select"
            value={selectedVariant}
            onChange={onVariantChange}
            options={variantOptions}
            className="w-full"
            size="sm"
          />
        </div>
        <FolderManagerButton
          onFoldersChanged={onFoldersChanged}
          size="sm"
          label="Edit Folders"
          namespace={namespace}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-[0.65rem] font-mono text-gray-600">
        <button
          onClick={onRunBrokenAudit}
          disabled={auditLoading}
          className="inline-flex items-center gap-2 px-3 py-1 border border-gray-300 rounded-md bg-white hover:bg-gray-100 disabled:opacity-50"
        >
          <AlertTriangle className="h-3 w-3" />
          {auditLoading ? 'Auditing…' : 'Audit broken URLs'}
        </button>
        <span>Broken: {brokenAudit.ids.length}</span>
        {brokenAudit.checkedAt && (
          <span>Last audit: {new Date(brokenAudit.checkedAt).toLocaleString()}</span>
        )}
        {(auditLoading || auditProgress.checked > 0) && (
          <span>Checked: {auditProgress.checked}/{auditProgress.total}</span>
        )}
      </div>
    </>
  );
}
