import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GalleryCompactHeader } from '@/components/gallery/GalleryCompactHeader';
import { GalleryPagerStrip } from '@/components/gallery/GalleryPagerStrip';
import { GalleryFilters } from '@/components/gallery/GalleryFilters';
import { GalleryNamespaceModal } from '@/components/gallery/GalleryNamespaceModal';
import LegacyTopBar from '@/components/gallery/LegacyTopBar';
import GalleryCommandBar from '@/components/GalleryCommandBar';
import { ToastProvider } from '@/components/Toast';

describe('gallery toolbar components', () => {
  it('renders the compact header with counts, page state, and a manual toggle', () => {
    const markup = renderToStaticMarkup(
      React.createElement(GalleryCompactHeader, {
        filteredCount: 12,
        totalCount: 40,
        pageIndex: 3,
        totalPages: 9,
        namespaceLabel: 'default',
        controlsVisible: true,
        showSearchButton: true,
        onToggleControls: vi.fn(),
        onOpenSearch: vi.fn(),
      })
    );

    expect(markup).toContain('Image Gallery (12/40)');
    expect(markup).toContain('Namespace: default');
    expect(markup).toContain('Page 3 / 9');
    expect(markup).toContain('Search');
    expect(markup).toContain('Hide controls');
  });

  it('renders compact header namespace labels for all and missing states', () => {
    const allMarkup = renderToStaticMarkup(
      React.createElement(GalleryCompactHeader, {
        filteredCount: 12,
        totalCount: 40,
        pageIndex: 3,
        totalPages: 9,
        namespaceLabel: 'All namespaces',
        controlsVisible: false,
        showSearchButton: false,
        onToggleControls: vi.fn(),
        onOpenSearch: vi.fn(),
      })
    );
    const missingMarkup = renderToStaticMarkup(
      React.createElement(GalleryCompactHeader, {
        filteredCount: 12,
        totalCount: 40,
        pageIndex: 3,
        totalPages: 9,
        namespaceLabel: 'Missing namespace',
        controlsVisible: false,
        showSearchButton: false,
        onToggleControls: vi.fn(),
        onOpenSearch: vi.fn(),
      })
    );

    expect(allMarkup).toContain('Namespace: All namespaces');
    expect(missingMarkup).toContain('Namespace: Missing namespace');
  });

  it('omits the search chip when semantic search is unavailable', () => {
    const markup = renderToStaticMarkup(
      React.createElement(GalleryCompactHeader, {
        filteredCount: 12,
        totalCount: 40,
        pageIndex: 3,
        totalPages: 9,
        namespaceLabel: 'default',
        controlsVisible: false,
        showSearchButton: false,
        onToggleControls: vi.fn(),
        onOpenSearch: vi.fn(),
      })
    );

    expect(markup).not.toContain('>Search<');
    expect(markup).toContain('Show controls');
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

  it('renders the updated gallery filter labels', () => {
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
    expect(markup).toContain('Parents With Variants');
    expect(markup).not.toContain('Variations Only');
  });

  it('renders selected all and hidden folder labels in the folder select', () => {
    const allMarkup = renderToStaticMarkup(
      React.createElement(GalleryFilters, {
        searchTerm: '',
        onSearchChange: vi.fn(),
        folders: ['640-walls'],
        selectedFolder: 'all',
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
    const hiddenMarkup = renderToStaticMarkup(
      React.createElement(GalleryFilters, {
        searchTerm: '',
        onSearchChange: vi.fn(),
        folders: ['640-walls'],
        selectedFolder: '640-walls',
        onFolderChange: vi.fn(),
        hiddenFolders: new Set<string>(['640-walls']),
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

    expect(allMarkup).toContain('All Folders');
    expect(allMarkup).not.toContain('Select…');
    expect(hiddenMarkup).toContain('640-walls (hidden)');
  });

  it('renders namespace delete affordance for deletable namespaces', () => {
    const markup = renderToStaticMarkup(
      React.createElement(GalleryNamespaceModal, {
        isOpen: true,
        namespaceSelectValue: 'client-space',
        namespaceDraft: 'client-space',
        namespaceOptions: [{ value: 'client-space', label: 'client-space' }],
        onSelectChange: vi.fn(),
        onDraftChange: vi.fn(),
        onCancel: vi.fn(),
        onSave: vi.fn(),
        selectedNamespaceForDelete: 'client-space',
        canDeleteSelectedNamespace: true,
        deletingNamespace: false,
        onDeleteNamespace: vi.fn(),
      })
    );

    expect(markup).toContain('Delete namespace');
    expect(markup).toContain('Rename namespace');
    expect(markup).toContain('Moves all assets in &quot;client-space&quot; to cf-default');
  });

  it('does not render rename or delete actions for cf-default', () => {
    const markup = renderToStaticMarkup(
      React.createElement(GalleryNamespaceModal, {
        isOpen: true,
        namespaceSelectValue: 'cf-default',
        namespaceDraft: 'cf-default',
        namespaceOptions: [{ value: 'cf-default', label: 'cf-default (default)' }],
        onSelectChange: vi.fn(),
        onDraftChange: vi.fn(),
        onCancel: vi.fn(),
        onSave: vi.fn(),
        selectedNamespaceForDelete: 'cf-default',
        canDeleteSelectedNamespace: false,
        deletingNamespace: false,
        onDeleteNamespace: vi.fn(),
      })
    );

    expect(markup).toContain('Protected namespace');
    expect(markup).toContain('&quot;cf-default&quot; is a system namespace');
    expect(markup).not.toContain('Delete namespace');
    expect(markup).not.toContain('Rename namespace');
  });

  it('advertises namespace visibility commands in the Gallery CLI', () => {
    const markup = renderToStaticMarkup(
      React.createElement(
        ToastProvider,
        null,
        React.createElement(GalleryCommandBar, {
          hiddenFolders: ['archive'],
          hiddenTags: ['draft', 'private'],
          hiddenNamespaces: ['cf-hidden'],
          knownFolders: [],
          knownTags: [],
          knownNamespaces: ['cf-flickr'],
          onHideFolder: vi.fn(),
          onUnhideFolder: vi.fn(),
          onClearHidden: vi.fn(),
          onHideTag: vi.fn(),
          onUnhideTag: vi.fn(),
          onClearHiddenTags: vi.fn(),
          onHideNamespace: vi.fn(),
          onUnhideNamespace: vi.fn(),
          onClearHiddenNamespaces: vi.fn(),
          onSelectFolder: vi.fn(),
          selectedTag: '',
          onSelectTag: vi.fn(),
          onClearTagFilter: vi.fn(),
          showParentsOnly: false,
          onSetParentsOnly: vi.fn(),
          currentPage: 1,
          totalPages: 1,
          onGoToPage: vi.fn(),
          embeddingFilter: 'none',
          onSetEmbeddingFilter: vi.fn(),
        })
      )
    );

    expect(markup).toContain('hide namespace &lt;name&gt;');
    expect(markup).toContain('list hidden namespaces');
    expect(markup).toContain('HIDDEN · 1 folder · 2 tags · 1 namespace');
  });
});
