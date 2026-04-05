'use client';

import DateNavigator from '@/components/DateNavigator';
import MonoSelect from '@/components/MonoSelect';
import type { AspectRatioClass, CloudflareImage, DateFilter } from '@/components/gallery/types';

interface ClientPageCatalogFiltersProps {
  allImages: CloudflareImage[];
  namespace: string;
  namespaceOptions: Array<{ value: string; label: string }>;
  selectedFolder: string;
  folderOptions: Array<{ value: string; label: string }>;
  selectedTag: string;
  tagOptions: Array<{ value: string; label: string }>;
  searchTerm: string;
  aspectRatio: AspectRatioClass | 'all';
  dateFilter: DateFilter | null;
  semanticQuery: string;
  semanticLoading: boolean;
  semanticError: string | null;
  hasSemanticFilter: boolean;
  onNamespaceChange: (value: string) => void;
  onFolderChange: (value: string) => void;
  onTagChange: (value: string) => void;
  onSearchTermChange: (value: string) => void;
  onAspectRatioChange: (value: AspectRatioClass | 'all') => void;
  onDateFilterChange: (value: DateFilter | null) => void;
  onSemanticQueryChange: (value: string) => void;
  onRunSemanticSearch: () => void;
  onClearFilters: () => void;
}

const controlClassName =
  'w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 focus:border-stone-500 focus:outline-none';

export function ClientPageCatalogFilters({
  allImages,
  namespace,
  namespaceOptions,
  selectedFolder,
  folderOptions,
  selectedTag,
  tagOptions,
  searchTerm,
  aspectRatio,
  dateFilter,
  semanticQuery,
  semanticLoading,
  semanticError,
  hasSemanticFilter,
  onNamespaceChange,
  onFolderChange,
  onTagChange,
  onSearchTermChange,
  onAspectRatioChange,
  onDateFilterChange,
  onSemanticQueryChange,
  onRunSemanticSearch,
  onClearFilters,
}: ClientPageCatalogFiltersProps) {
  return (
    <section className="rounded-md border border-stone-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-mono uppercase tracking-[0.24em] text-stone-500">Catalog filters</p>
          <p className="mt-1 text-sm text-stone-600">
            Browse existing Photarium assets, then add or remove them from this client page.
          </p>
        </div>
        <button
          type="button"
          onClick={onClearFilters}
          className="rounded-md border border-stone-300 px-3 py-2 text-xs font-mono text-stone-600 hover:bg-stone-100"
        >
          Clear filters
        </button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="block">
          <span className="mb-1 block text-[11px] font-mono uppercase tracking-[0.18em] text-stone-500">
            Search
          </span>
          <input
            value={searchTerm}
            onChange={(event) => onSearchTermChange(event.target.value)}
            className={controlClassName}
            placeholder="Filename, tag, description"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] font-mono uppercase tracking-[0.18em] text-stone-500">
            Namespace
          </span>
          <MonoSelect
            value={namespace}
            options={namespaceOptions}
            onChange={onNamespaceChange}
            className="w-full"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] font-mono uppercase tracking-[0.18em] text-stone-500">
            Folder
          </span>
          <MonoSelect
            value={selectedFolder}
            options={folderOptions}
            onChange={onFolderChange}
            className="w-full"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] font-mono uppercase tracking-[0.18em] text-stone-500">
            Tag
          </span>
          <MonoSelect
            value={selectedTag}
            options={tagOptions}
            onChange={onTagChange}
            className="w-full"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] font-mono uppercase tracking-[0.18em] text-stone-500">
            Aspect
          </span>
          <MonoSelect
            value={aspectRatio}
            options={[
              { value: 'all', label: 'All ratios' },
              { value: 'horizontal', label: 'Horizontal' },
              { value: 'vertical', label: 'Vertical' },
              { value: 'square', label: 'Square' },
            ]}
            onChange={(value) => onAspectRatioChange(value as AspectRatioClass | 'all')}
            className="w-full"
          />
        </label>

        <div className="block">
          <span className="mb-1 block text-[11px] font-mono uppercase tracking-[0.18em] text-stone-500">
            Date range
          </span>
          <DateNavigator
            allImages={allImages}
            currentFilter={dateFilter}
            onFilterChange={onDateFilterChange}
          />
        </div>

        <div className="md:col-span-2 xl:col-span-2">
          <span className="mb-1 block text-[11px] font-mono uppercase tracking-[0.18em] text-stone-500">
            Semantic search
          </span>
          <div className="flex gap-2">
            <input
              value={semanticQuery}
              onChange={(event) => onSemanticQueryChange(event.target.value)}
              className={controlClassName}
              placeholder="Run CLIP search within the current namespace scope"
            />
            <button
              type="button"
              onClick={onRunSemanticSearch}
              disabled={semanticLoading}
              className="rounded-md border border-stone-300 px-3 py-2 text-xs font-mono text-stone-700 hover:bg-stone-100 disabled:opacity-60"
            >
              {semanticLoading ? 'Searching…' : hasSemanticFilter ? 'Refresh' : 'Search'}
            </button>
          </div>
          {semanticError ? (
            <p className="mt-1 text-xs text-rose-600">{semanticError}</p>
          ) : hasSemanticFilter ? (
            <p className="mt-1 text-xs text-stone-500">Semantic filter applied to the catalog results.</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
