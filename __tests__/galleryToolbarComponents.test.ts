import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GalleryCompactHeader } from '@/components/gallery/GalleryCompactHeader';
import { GalleryPagerStrip } from '@/components/gallery/GalleryPagerStrip';
import { GalleryFilters } from '@/components/gallery/GalleryFilters';
import LegacyTopBar from '@/components/gallery/LegacyTopBar';

describe('gallery toolbar components', () => {
  it('renders the compact header with counts, page state, and a manual toggle', () => {
    const markup = renderToStaticMarkup(
      React.createElement(GalleryCompactHeader, {
        filteredCount: 12,
        totalCount: 40,
        pageIndex: 3,
        totalPages: 9,
        controlsVisible: true,
        onToggleControls: vi.fn(),
      })
    );

    expect(markup).toContain('Image Gallery (12/40)');
    expect(markup).toContain('Page 3 / 9');
    expect(markup).toContain('Hide controls');
  });

  it('renders the pager strip outside the legacy toolbar layout', () => {
    const markup = renderToStaticMarkup(
      React.createElement(GalleryPagerStrip, {
        pageIndex: 4,
        totalPages: 12,
        prevPageRangeLabel: 'Jan 1',
        nextPageRangeLabel: 'Jan 2',
        onFirstPage: vi.fn(),
        onJumpBackTen: vi.fn(),
        onPrevPage: vi.fn(),
        onNextPage: vi.fn(),
        onJumpForwardTen: vi.fn(),
        onLastPage: vi.fn(),
      })
    );

    expect(markup).toContain('First');
    expect(markup).toContain('-10');
    expect(markup).toContain('Prev');
    expect(markup).toContain('4 / 12');
    expect(markup).toContain('Next');
    expect(markup).toContain('+10');
    expect(markup).toContain('Last');
  });

  it('legacy top bar no longer renders pager buttons', () => {
    const markup = renderToStaticMarkup(
      React.createElement(LegacyTopBar, {
        filteredCount: 12,
        totalCount: 40,
        namespaceLabel: 'default',
        namespace: 'default',
        showPagination: true,
        currentPageRangeLabel: 'Jan 1',
        sortedImages: [{ id: 'img-1', uploaded: '2026-01-01T00:00:00.000Z' }],
        dateFilter: null,
        onDateFilterChange: vi.fn(),
        bulkSelectionMode: false,
        filtersCollapsed: false,
        hasActiveFilters: false,
        pageSize: 30,
        pageSizeOptions: [12, 30],
        defaultPageSize: 30,
        gridSize: 'medium',
        refreshingCache: false,
        viewMode: 'grid',
        selectedCount: 0,
        bulkEmbeddingGenerating: false,
        bulkDeleting: false,
        onToggleBulkSelection: vi.fn(),
        onToggleFilters: vi.fn(),
        onClearFilters: vi.fn(),
        onPageSizeChange: vi.fn(),
        onGridSizeChange: vi.fn(),
        onRefreshCache: vi.fn(),
        onOpenNamespaceSettings: vi.fn(),
        onToggleViewMode: vi.fn(),
        onSelectPage: vi.fn(),
        onClearSelection: vi.fn(),
        onOpenBulkEdit: vi.fn(),
        onGenerateEmbeddings: vi.fn(),
        onDeleteSelected: vi.fn(),
      })
    );

    expect(markup).not.toContain('>First<');
    expect(markup).not.toContain('>Prev<');
    expect(markup).not.toContain('>Next<');
    expect(markup).not.toContain('>Last<');
  });

  it('renders the motion assets checkbox in the filter row', () => {
    const markup = renderToStaticMarkup(
      React.createElement(GalleryFilters, {
        searchTerm: '',
        onSearchChange: vi.fn(),
        folders: [],
        selectedFolder: '',
        onFolderChange: vi.fn(),
        hiddenFolders: new Set<string>(),
        onToggleHiddenFolder: vi.fn(),
        onShowAllFolders: vi.fn(),
        allTags: [],
        selectedTag: '',
        onTagChange: vi.fn(),
        hiddenTags: new Set<string>(),
        onToggleHiddenTag: vi.fn(),
        onShowAllTags: vi.fn(),
        aspectRatioFilters: [],
        onAspectRatioFiltersChange: vi.fn(),
        showDuplicatesOnly: false,
        onShowDuplicatesOnlyChange: vi.fn(),
        showVariationsOnly: false,
        onShowVariationsOnlyChange: vi.fn(),
        showMotionAssetsOnly: false,
        onShowMotionAssetsOnlyChange: vi.fn(),
        showOnlyMissingEmbeddings: false,
        onShowOnlyMissingEmbeddingsChange: vi.fn(),
        onlyCanonical: false,
        onOnlyCanonicalChange: vi.fn(),
        respectAspectRatio: false,
        onRespectAspectRatioChange: vi.fn(),
        showBrokenOnly: false,
        onShowBrokenOnlyChange: vi.fn(),
        showComfyOnly: false,
        onShowComfyOnlyChange: vi.fn(),
        onClearFilters: vi.fn(),
        hasActiveFilters: false,
      })
    );

    expect(markup).toContain('Motion Assets Only');
  });
});
