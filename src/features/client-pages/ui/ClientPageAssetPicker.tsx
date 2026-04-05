'use client';

import { useEffect } from 'react';
import { ClientPageCatalogFilters } from './ClientPageCatalogFilters';
import { ClientPageCatalogGrid } from './ClientPageCatalogGrid';
import { useClientPageCatalog } from './useClientPageCatalog';
import type { CloudflareImage } from '@/components/gallery/types';

interface ClientPageAssetPickerProps {
  selectedImageIds: string[];
  initialNamespace?: string;
  busy: boolean;
  onImagesLoaded?: (images: CloudflareImage[]) => void;
  onToggleImage: (imageId: string) => void;
  onAddMany: (imageIds: string[]) => void;
  onRemoveMany: (imageIds: string[]) => void;
}

export function ClientPageAssetPicker({
  selectedImageIds,
  initialNamespace,
  busy,
  onImagesLoaded,
  onToggleImage,
  onAddMany,
  onRemoveMany,
}: ClientPageAssetPickerProps) {
  const catalog = useClientPageCatalog(initialNamespace ?? '__all__');
  const selectedSet = new Set(selectedImageIds);

  useEffect(() => {
    onImagesLoaded?.(catalog.images);
  }, [catalog.images, onImagesLoaded]);

  return (
    <div className="space-y-4">
      <ClientPageCatalogFilters
        allImages={catalog.images}
        namespace={catalog.namespace}
        namespaceOptions={catalog.namespaceOptions}
        selectedFolder={catalog.selectedFolder}
        folderOptions={catalog.folderOptions}
        selectedTag={catalog.selectedTag}
        tagOptions={catalog.tagOptions}
        searchTerm={catalog.searchTerm}
        aspectRatio={catalog.aspectRatio}
        dateFilter={catalog.dateFilter}
        semanticQuery={catalog.semanticQuery}
        semanticLoading={catalog.semanticLoading}
        semanticError={catalog.semanticError}
        hasSemanticFilter={catalog.hasSemanticFilter}
        onNamespaceChange={catalog.setNamespace}
        onFolderChange={catalog.setSelectedFolder}
        onTagChange={catalog.setSelectedTag}
        onSearchTermChange={catalog.setSearchTerm}
        onAspectRatioChange={catalog.setAspectRatio}
        onDateFilterChange={catalog.setDateFilter}
        onSemanticQueryChange={catalog.setSemanticQuery}
        onRunSemanticSearch={catalog.runSemanticSearch}
        onClearFilters={catalog.clearFilters}
      />

      <section className="rounded-md border border-stone-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 pb-4">
          <div>
            <p className="text-[11px] font-mono uppercase tracking-[0.24em] text-stone-500">Picker</p>
            <p className="mt-1 text-sm text-stone-600">
              {catalog.filteredImages.length} filtered assets, page {catalog.currentPage} of {catalog.totalPages}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onAddMany(catalog.pageImages.map((image) => image.id))}
              disabled={busy || catalog.pageImages.length === 0}
              className="rounded-md border border-stone-300 px-3 py-2 text-xs font-mono text-stone-700 hover:bg-stone-100 disabled:opacity-60"
            >
              Add current page
            </button>
            <button
              type="button"
              onClick={() => onAddMany(catalog.filteredImages.map((image) => image.id))}
              disabled={busy || catalog.filteredImages.length === 0}
              className="rounded-md border border-stone-300 px-3 py-2 text-xs font-mono text-stone-700 hover:bg-stone-100 disabled:opacity-60"
            >
              Add filtered set
            </button>
            <button
              type="button"
              onClick={() =>
                onRemoveMany(
                  catalog.filteredImages.filter((image) => selectedSet.has(image.id)).map((image) => image.id)
                )
              }
              disabled={
                busy ||
                catalog.filteredImages.every((image) => !selectedSet.has(image.id))
              }
              className="rounded-md border border-stone-300 px-3 py-2 text-xs font-mono text-stone-700 hover:bg-stone-100 disabled:opacity-60"
            >
              Remove filtered from project
            </button>
          </div>
        </div>

        {catalog.loading ? (
          <div className="py-8 text-sm text-stone-500">Loading catalog…</div>
        ) : catalog.error ? (
          <div className="py-8 text-sm text-rose-600">{catalog.error}</div>
        ) : (
          <div className="space-y-4 pt-4">
            <ClientPageCatalogGrid
              images={catalog.pageImages}
              selectedImageIds={selectedSet}
              busy={busy}
              onToggleImage={onToggleImage}
            />

            <div className="flex items-center justify-between gap-3 border-t border-stone-200 pt-4">
              <button
                type="button"
                onClick={() => catalog.setCurrentPage(Math.max(1, catalog.currentPage - 1))}
                disabled={catalog.currentPage === 1}
                className="rounded-md border border-stone-300 px-3 py-2 text-xs font-mono text-stone-700 hover:bg-stone-100 disabled:opacity-50"
              >
                Previous page
              </button>
              <span className="text-xs font-mono text-stone-500">
                {catalog.pageImages.length} assets on this page
              </span>
              <button
                type="button"
                onClick={() => catalog.setCurrentPage(Math.min(catalog.totalPages, catalog.currentPage + 1))}
                disabled={catalog.currentPage === catalog.totalPages}
                className="rounded-md border border-stone-300 px-3 py-2 text-xs font-mono text-stone-700 hover:bg-stone-100 disabled:opacity-50"
              >
                Next page
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
