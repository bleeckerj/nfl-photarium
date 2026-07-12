/**
 * ImageGallery Component
 * 
 * Main orchestrator component that composes all gallery submodules.
 * Manages state through custom hooks and renders UI components.
 * 
 * Architecture:
 * - useGalleryData: Fetches images, colors, namespaces
 * - useGalleryFilters: Manages filter state and computed filtered lists
 * - useGallerySelection: Handles bulk selection operations
 * - useGalleryPagination: Manages pagination state and navigation
 * - useGalleryActions: Handles image operations (delete, edit, etc.)
 * - useGalleryAudit: Broken URL audit functionality
 */

'use client';

import React, { forwardRef, useImperativeHandle, useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Settings, Cpu, AlertTriangle } from 'lucide-react';
import MonoSelect from '@/components/MonoSelect';
import DateNavigator from '@/components/DateNavigator';
import GalleryCommandBar from '@/components/GalleryCommandBar';
import { useToast } from '@/components/Toast';
import { subscribeEmbeddingPending, clearPendingIfHasEmbeddings, type EmbeddingPendingEntry } from '@/utils/embeddingPending';

// Gallery module imports
import {
  useGalleryData,
  useGalleryFilters,
  useGallerySelection,
  useGalleryPagination,
  useGalleryActions,
  useGalleryAudit,
  useHoverPreview,
} from './hooks';
import {
  ImageCard,
  ImageListItem,
  GalleryEmptyState,
} from './index';
import { ImageGalleryModalStack } from './ImageGalleryModalStack';
import {
  loadPreferences,
  loadHiddenNamespaces,
  persistPreferences,
} from './storage';
import {
  getNamespaceOptions,
  getUniqueFolders,
  getUniqueTags,
} from './utils';
import { toDateKey } from './dateFilter';
import {
  VARIANT_OPTIONS,
  PAGE_SIZE_OPTIONS,
  AUDIT_LOG_LIMIT,
} from './constants';
import type {
  ImageGalleryProps,
  ImageGalleryRef,
  ViewMode,
} from './types';

// ============================================================================
// Main Component
// ============================================================================

const ImageGallery = forwardRef<ImageGalleryRef, ImageGalleryProps>(
  ({ refreshTrigger, namespace, onNamespaceChange }, ref) => {
    const toast = useToast();
    
    // ========================================================================
    // Stored Preferences
    // ========================================================================
    const storedPreferencesRef = useRef(loadPreferences());
    
    // ========================================================================
    // View State
    // ========================================================================
    const [viewMode, setViewMode] = useState<ViewMode>(
      (storedPreferencesRef.current.viewMode ?? 'grid') as ViewMode
    );
    const [selectedVariant, setSelectedVariant] = useState<string>(
      storedPreferencesRef.current.variant
    );
    const [filtersCollapsed] = useState(
      storedPreferencesRef.current.filtersCollapsed ?? false
    );
    
    // ========================================================================
    // Modal State
    // ========================================================================
    const [copyMenuImageId, setCopyMenuImageId] = useState<string | null>(null);
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
    const [namespaceSettingsOpen, setNamespaceSettingsOpen] = useState(false);
    const [bulkEditOpen, setBulkEditOpen] = useState(false);
    
    const {
      hoveredImage,
      showPreview,
      mousePosition,
      handleMouseEnter,
      handleMouseMove,
      handleMouseLeave,
    } = useHoverPreview();
    
    // ========================================================================
    // Embedding Pending State
    // ========================================================================
    const [embeddingPendingMap, setEmbeddingPendingMap] = useState<Record<string, EmbeddingPendingEntry>>({});
    
    // ========================================================================
    // Data Hook
    // ========================================================================
    const {
      images,
      loading,
      refreshingCache,
      colorMetadataMap,
      registryNamespaces,
      fetchImages,
      setImages,
    } = useGalleryData({ namespace, refreshTrigger });
    
    // ========================================================================
    // Audit Hook
    // ========================================================================
    const {
      brokenAudit,
      brokenImageIds,
      auditLoading,
      auditProgress,
      auditEntries,
      runBrokenAudit,
    } = useGalleryAudit({ images, selectedVariant, toast });
    
    // ========================================================================
    // Filters Hook
    // ========================================================================
    const {
      selectedFolder,
      setSelectedFolder,
      selectedTag,
      setSelectedTag,
      searchTerm,
      setSearchTerm,
      onlyCanonical,
      setOnlyCanonical,
      respectAspectRatio,
      setRespectAspectRatio,
      onlyWithVariants,
      setOnlyWithVariants,
      showComfyOnly,
      setShowComfyOnly,
      showFavoritesOnly,
      setShowFavoritesOnly,
      showDuplicatesOnly,
      setShowDuplicatesOnly,
      showBrokenOnly,
      setShowBrokenOnly,
      embeddingFilter,
      setEmbeddingFilter,
      dateFilter,
      setDateFilter,
      hiddenFolders,
      hiddenTags,
      hiddenNamespaces,
      hideFolderByName,
      unhideFolderByName,
      clearHiddenFolders,
      hideTagByName,
      unhideTagByName,
      clearHiddenTags,
      hideNamespaceByName,
      unhideNamespaceByName,
      clearHiddenNamespaces,
      sortedImages,
      duplicateGroups,
      duplicateIds,
      childrenMap,
      familySummaryMap,
      hasActiveFilters,
      clearFilters,
    } = useGalleryFilters({
      images,
      initialPreferences: {
        ...storedPreferencesRef.current,
        hiddenNamespaces: loadHiddenNamespaces(),
      },
      brokenImageIds,
    });
    
    // ========================================================================
    // Selection Hook
    // ========================================================================
    const {
      bulkSelectionMode,
      setBulkSelectionMode,
      selectedImageIds,
      selectedCount,
      toggleSelection,
      clearSelection,
      selectAllOnPage,
      selectDuplicateImages,
      selectDuplicatesKeepSingle,
    } = useGallerySelection({
      images,
      duplicateGroups,
      duplicateIds,
    });
    
    // ========================================================================
    // Pagination Hook
    // ========================================================================
    const {
      currentPage,
      pageSize,
      setPageSize,
      totalPages,
      pageImages,
      showPagination,
      hasResults,
      pageIndex,
      goToPageNumber,
      goToPreviousPage,
      goToNextPage,
      goToFirstPage,
      goToLastPage,
      jumpBackTenPages,
      jumpForwardTenPages,
      currentPageRangeLabel,
    } = useGalleryPagination({
      filteredImages: sortedImages,
      initialPage: storedPreferencesRef.current.currentPage,
      initialPageSize: storedPreferencesRef.current.pageSize,
    });
    
    // ========================================================================
    // Actions Hook
    // ========================================================================
    const {
      deleteImage,
      generateAltTag,
      altLoadingMap,
      editingImage,
      editTags,
      setEditTags,
      startEdit,
      cancelEdit,
      saveEdit,
      bulkUpdating,
      bulkDeleting,
      bulkEmbeddingGenerating,
      generateDisplayName,
      displayNameLoadingMap,
      toggleFavorite,
      favoriteLoadingMap,
      applyBulkUpdates,
      deleteSelectedImages,
      generateEmbeddingsForSelected,
      refreshEmbeddingsForSelected,
      queueEmbeddingsForSelected,
      bulkAnimateLoading,
      bulkAnimateError,
      createBulkAnimation,
    } = useGalleryActions({
      images,
      setImages,
      selectedImageIds,
      clearSelection,
      setBulkSelectionMode,
      fetchImages,
      namespace,
      toast,
    });
    
    // ========================================================================
    // Computed Values
    // ========================================================================
    const uniqueFolders = useMemo(() => getUniqueFolders(images), [images]);
    const uniqueTags = useMemo(() => getUniqueTags(images), [images]);
    const namespaceOptions = useMemo(
      () => getNamespaceOptions(images, registryNamespaces),
      [images, registryNamespaces]
    );
    const knownNamespaces = useMemo(
      () => Array.from(new Set([
        ...namespaceOptions.map(option => option.value),
        ...hiddenNamespaces,
      ].filter(value => value && value !== '__all__' && value !== '__custom__'))).sort((a, b) => a.localeCompare(b)),
      [hiddenNamespaces, namespaceOptions]
    );
    
    const duplicateGroupCount = duplicateGroups.length;
    const duplicateImageCount = duplicateGroups.reduce((acc, g) => acc + g.items.length, 0);
    const showLastUploaded = useCallback(() => {
      if (!sortedImages.length) {
        return null;
      }
      const newestDate = new Date(sortedImages[0].uploaded);
      if (Number.isNaN(newestDate.getTime())) {
        return null;
      }
      const newestDateKey = toDateKey(newestDate);
      const count = sortedImages.reduce((acc, image) => {
        const uploadedDate = new Date(image.uploaded);
        if (Number.isNaN(uploadedDate.getTime())) {
          return acc;
        }
        return toDateKey(uploadedDate) === newestDateKey ? acc + 1 : acc;
      }, 0);
      setDateFilter({ startDate: newestDateKey, endDate: newestDateKey });
      return { dateKey: newestDateKey, count };
    }, [setDateFilter, sortedImages]);
    
    // ========================================================================
    // Imperative Handle
    // ========================================================================
    useImperativeHandle(ref, () => ({
      refreshImages: () => fetchImages({ silent: true }),
    }), [fetchImages]);
    
    // ========================================================================
    // Effects
    // ========================================================================
    
    // Persist preferences
    useEffect(() => {
      persistPreferences({
        variant: selectedVariant,
        onlyCanonical,
        respectAspectRatio,
        onlyWithVariants,
        showComfyOnly,
        showFavoritesOnly,
        selectedFolder,
        selectedTag,
        searchTerm,
        viewMode,
        filtersCollapsed,
        bulkFolderInput: '',
        bulkFolderMode: 'existing',
        showDuplicatesOnly,
        showBrokenOnly,
        pageSize,
        dateFilter,
        currentPage,
      });
    }, [
      selectedVariant, onlyCanonical, respectAspectRatio, onlyWithVariants,
      showComfyOnly, showFavoritesOnly,
      selectedFolder, selectedTag, searchTerm, viewMode, filtersCollapsed,
      showDuplicatesOnly, showBrokenOnly, pageSize, dateFilter, currentPage,
    ]);
    
    // Subscribe to embedding pending events
    useEffect(() => {
      const unsub = subscribeEmbeddingPending((entries) => {
        setEmbeddingPendingMap(entries);
      });
      return unsub;
    }, []);
    
    // Clear pending if embeddings exist
    useEffect(() => {
      for (const image of images) {
        if (image.hasClipEmbedding || image.hasColorEmbedding) {
          clearPendingIfHasEmbeddings(image.id, image.hasClipEmbedding, image.hasColorEmbedding);
        }
      }
    }, [images]);
    
    // ========================================================================
    // Action Handlers
    // ========================================================================
    const handleCopyUrl = useCallback((imageId: string) => {
      setCopyMenuImageId(imageId);
    }, []);
    
    const handleCopyNamespace = useCallback((ns: string) => {
      navigator.clipboard.writeText(ns).then(() => {
        toast.push('Namespace copied');
      });
    }, [toast]);
    
    const handleDeleteConfirm = useCallback((imageId: string) => {
      setDeleteConfirmId(imageId);
    }, []);
    
    const handleDeleteImage = useCallback(async () => {
      if (deleteConfirmId) {
        await deleteImage(deleteConfirmId);
        setDeleteConfirmId(null);
      }
    }, [deleteConfirmId, deleteImage]);
    
    const openBulkEditModal = useCallback(() => {
      setBulkEditOpen(true);
    }, []);
    
    const closeBulkEditModal = useCallback(() => {
      setBulkEditOpen(false);
    }, []);
    
    // ========================================================================
    // Render: Loading State
    // ========================================================================
    if (loading) {
      return (
        <div className="flex items-center justify-center h-48 text-gray-500 font-mono text-sm">
          Loading images...
        </div>
      );
    }
    
    // ========================================================================
    // Render: Empty State
    // ========================================================================
    if (images.length === 0) {
      return <GalleryEmptyState hasFilters={false} />;
    }
    
    // ========================================================================
    // Render: Main Gallery
    // ========================================================================
    return (
      <div className="space-y-4">
        {/* Top Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-gray-50 border rounded-lg">
          {/* Left: Counts and date navigator */}
          <div className="flex items-center gap-3">
            <div className="text-[0.7em] font-mono text-gray-600">
              {sortedImages.length === images.length ? (
                <span>{images.length.toLocaleString()} images</span>
              ) : (
                <span>
                  {sortedImages.length.toLocaleString()} / {images.length.toLocaleString()} images
                </span>
              )}
            </div>
            
            <DateNavigator
              allImages={images}
              currentFilter={dateFilter}
              onFilterChange={setDateFilter}
            />
          </div>
          
          {/* Right: Controls */}
          <div className="flex items-center gap-2">
            <MonoSelect
              value={selectedVariant}
              onChange={setSelectedVariant}
              options={VARIANT_OPTIONS}
              size="sm"
            />
            
            <button
              onClick={() => fetchImages({ forceRefresh: true })}
              disabled={refreshingCache}
              className="px-3 py-1 text-[0.7em] font-mono border border-gray-200 rounded-md hover:bg-gray-100 transition disabled:opacity-50"
              title="Refresh the server-side Cloudflare cache"
            >
              {refreshingCache ? 'Refreshing…' : 'Refresh cache'}
            </button>
            
            <button
              onClick={() => setNamespaceSettingsOpen(true)}
              className="px-3 py-1 text-[0.7em] font-mono border border-gray-200 rounded-md hover:bg-gray-100 transition flex items-center gap-2"
              title="Namespace settings"
            >
              <Settings className="h-3 w-3" />
              Namespace
            </button>
            
            <button
              onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
              className="px-3 py-1 text-[0.7em] font-mono bg-gray-100 hover:bg-gray-200 rounded-md"
            >
              {viewMode === 'grid' ? '📋 List' : '🔲 Grid'}
            </button>
          </div>
        </div>
        
        {/* Bulk Selection Bar */}
        {(bulkSelectionMode || selectedCount > 0) && (
          <div className="flex flex-wrap items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg text-[0.7em] font-mono text-gray-700">
            <span>{selectedCount} selected</span>
            <button
              onClick={() => selectAllOnPage(pageImages)}
              className="px-2 py-1 border rounded-md hover:bg-white"
            >
              Select page
            </button>
            <button
              onClick={clearSelection}
              className="px-2 py-1 border rounded-md hover:bg-white"
            >
              Clear
            </button>
            <button
              onClick={openBulkEditModal}
              className="px-2 py-1 bg-gray-900 text-white rounded-md hover:bg-black disabled:opacity-40"
              disabled={!selectedCount}
            >
              Bulk edit
            </button>
            <button
              onClick={queueEmbeddingsForSelected}
              className="px-2 py-1 border border-amber-300 text-amber-700 rounded-md hover:bg-amber-50 disabled:opacity-40 inline-flex items-center gap-1"
              disabled={!selectedCount || bulkEmbeddingGenerating}
              title="Queue selected images for embedding generation"
            >
              <Cpu className="h-3 w-3" />
              Queue Embeddings
            </button>
            <button
              onClick={generateEmbeddingsForSelected}
              className="px-2 py-1 border border-green-300 text-green-700 rounded-md hover:bg-green-50 disabled:opacity-40 inline-flex items-center gap-1"
              disabled={!selectedCount || bulkEmbeddingGenerating}
              title="Generate CLIP and color embeddings for selected images"
            >
              <Cpu className="h-3 w-3" />
              {bulkEmbeddingGenerating ? 'Generating…' : 'Generate Embeddings'}
            </button>
            <button
              onClick={refreshEmbeddingsForSelected}
              className="px-2 py-1 border border-emerald-300 text-emerald-700 rounded-md hover:bg-emerald-50 disabled:opacity-40 inline-flex items-center gap-1"
              disabled={!selectedCount || bulkEmbeddingGenerating}
              title="Force refresh CLIP and color embeddings for selected images"
            >
              <Cpu className="h-3 w-3" />
              Refresh Embeddings
            </button>
            <button
              onClick={deleteSelectedImages}
              className="px-2 py-1 border border-red-300 text-red-700 rounded-md hover:bg-red-50 disabled:opacity-40"
              disabled={!selectedCount || bulkDeleting}
            >
              {bulkDeleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        )}
        
        {/* Duplicate Groups Alert */}
        {duplicateGroupCount > 0 && (
          <div className="flex flex-col gap-2 p-3 rounded-lg border border-amber-200 bg-amber-50 text-[0.65rem] font-mono text-amber-900">
            <div>
              Found {duplicateGroupCount} duplicate group{duplicateGroupCount === 1 ? '' : 's'} affecting{' '}
              {duplicateImageCount} image{duplicateImageCount === 1 ? '' : 's'} (must match both original URL and content hash).
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setShowDuplicatesOnly(!showDuplicatesOnly)}
                className="px-3 py-1 rounded-md border border-amber-300 bg-white text-amber-900 hover:bg-amber-100 transition"
              >
                {showDuplicatesOnly ? 'Show all images' : 'Show duplicates only'}
              </button>
              <button
                onClick={selectDuplicateImages}
                className="px-3 py-1 rounded-md border border-amber-300 bg-amber-100 text-amber-900 hover:bg-amber-200 transition"
              >
                Select all duplicates
              </button>
              <button
                onClick={() => selectDuplicatesKeepSingle('newest')}
                className="px-3 py-1 rounded-md border border-amber-300 bg-amber-100 text-amber-900 hover:bg-amber-200 transition"
              >
                Select duplicates (keep newest)
              </button>
              <button
                onClick={() => selectDuplicatesKeepSingle('oldest')}
                className="px-3 py-1 rounded-md border border-amber-300 bg-amber-100 text-amber-900 hover:bg-amber-200 transition"
              >
                Select duplicates (keep oldest)
              </button>
            </div>
          </div>
        )}
        
        {/* Filters & Command Bar */}
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3 bg-gray-50 p-3 border rounded-lg">
          {/* Search */}
          <div className="md:col-span-2">
            <input
              type="text"
              placeholder="Search images..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-3 py-1 text-[0.7em] font-mono border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          
          {/* Folder Select */}
          <div className="md:col-span-1">
            <MonoSelect
              value={selectedFolder}
              onChange={setSelectedFolder}
              options={[
                { value: 'all', label: 'All folders' },
                { value: 'no-folder', label: '(no folder)' },
                ...uniqueFolders.map((f) => ({ value: f, label: f })),
              ]}
              size="sm"
            />
          </div>
          
          {/* Tag Select */}
          <div className="md:col-span-1">
            <MonoSelect
              value={selectedTag}
              onChange={setSelectedTag}
              options={[
                { value: '', label: 'All tags' },
                ...uniqueTags.map((t) => ({ value: t, label: t })),
              ]}
              size="sm"
            />
          </div>
          
          {/* Namespace Select */}
          <div className="md:col-span-2">
            <MonoSelect
              value={namespace || '__all__'}
              onChange={(value) => onNamespaceChange?.(value)}
              options={namespaceOptions}
              size="sm"
            />
          </div>
          
          {/* Checkboxes */}
          <div className="md:col-span-4 flex flex-wrap items-center gap-4 text-[0.65rem] font-mono">
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={showFavoritesOnly}
                onChange={(e) => setShowFavoritesOnly(e.target.checked)}
                className="h-3 w-3"
              />
              favorites
            </label>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={onlyCanonical}
                onChange={(e) => setOnlyCanonical(e.target.checked)}
                className="h-3 w-3"
              />
              no children
            </label>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={onlyWithVariants}
                onChange={(e) => setOnlyWithVariants(e.target.checked)}
                className="h-3 w-3"
              />
              parents
            </label>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={showDuplicatesOnly}
                onChange={(e) => setShowDuplicatesOnly(e.target.checked)}
                className="h-3 w-3"
              />
              duplicates
            </label>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={showBrokenOnly}
                onChange={(e) => setShowBrokenOnly(e.target.checked)}
                className="h-3 w-3"
              />
              broken
            </label>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={embeddingFilter === 'missing-both'}
                onChange={(e) => setEmbeddingFilter(e.target.checked ? 'missing-both' : 'none')}
                className="h-3 w-3"
              />
              no embeddings
            </label>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={showComfyOnly}
                onChange={(e) => setShowComfyOnly(e.target.checked)}
                className="h-3 w-3"
              />
              comfyui
            </label>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={respectAspectRatio}
                onChange={(e) => setRespectAspectRatio(e.target.checked)}
                className="h-3 w-3"
              />
              aspect ratio
            </label>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={bulkSelectionMode}
                onChange={(e) => setBulkSelectionMode(e.target.checked)}
                className="h-3 w-3"
              />
              select mode
            </label>
          </div>
          
          {/* Audit section */}
          <div className="md:col-span-6 flex flex-wrap items-center gap-3 text-[0.65rem] font-mono text-gray-600">
            <button
              onClick={runBrokenAudit}
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
          
          {/* Audit Log */}
          {(auditLoading || auditEntries.length > 0) && (
            <div className="md:col-span-6 rounded-md border border-gray-200 bg-white p-3 text-[0.65rem] font-mono text-gray-700">
              <div className="flex items-center justify-between">
                <span>Audit log {auditEntries.length >= AUDIT_LOG_LIMIT ? `(last ${AUDIT_LOG_LIMIT})` : ''}</span>
                {auditLoading && <span className="text-gray-500">Running…</span>}
              </div>
              <div className="mt-2 h-1 w-full rounded-full bg-gray-100">
                <div
                  className="h-1 rounded-full bg-blue-500 transition-[width]"
                  style={{
                    width: auditProgress.total
                      ? `${Math.min(100, (auditProgress.checked / auditProgress.total) * 100)}%`
                      : '0%',
                  }}
                />
              </div>
              <div className="mt-2 max-h-40 overflow-y-auto space-y-1">
                {auditEntries.map((entry) => (
                  <div key={`${entry.id}-${entry.url ?? ''}-${entry.status ?? ''}`} className="flex items-start justify-between gap-2">
                    <div className="text-gray-600">
                      <div>{entry.id}</div>
                      <div className="text-gray-400">{entry.filename ?? '[no filename]'}</div>
                    </div>
                    <span className="text-gray-500">{entry.status ?? '—'} {entry.reason ?? ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Gallery Command Bar */}
          <div className="md:col-span-6">
            <GalleryCommandBar
              hiddenFolders={hiddenFolders}
              hiddenTags={hiddenTags}
              hiddenNamespaces={hiddenNamespaces}
              knownFolders={uniqueFolders}
              knownTags={uniqueTags}
              knownNamespaces={knownNamespaces}
              onHideFolder={hideFolderByName}
              onUnhideFolder={unhideFolderByName}
              onClearHidden={clearHiddenFolders}
              onHideTag={hideTagByName}
              onUnhideTag={unhideTagByName}
              onClearHiddenTags={clearHiddenTags}
              onHideNamespace={hideNamespaceByName}
              onUnhideNamespace={unhideNamespaceByName}
              onClearHiddenNamespaces={clearHiddenNamespaces}
              onSelectFolder={setSelectedFolder}
              selectedTag={selectedTag}
              onSelectTag={setSelectedTag}
              onClearTagFilter={() => setSelectedTag('')}
              showParentsOnly={onlyWithVariants}
              onSetParentsOnly={setOnlyWithVariants}
              showComfyOnly={showComfyOnly}
              onSetComfyOnly={setShowComfyOnly}
              currentPage={pageIndex}
              totalPages={totalPages}
              onGoToPage={goToPageNumber}
              embeddingFilter={embeddingFilter}
              onSetEmbeddingFilter={setEmbeddingFilter}
              onShowLastUploaded={showLastUploaded}
            />
          </div>
        </div>
        
        {/* Pagination (Top) */}
        {showPagination && (
          <div className="flex items-center justify-between gap-3 p-2 bg-gray-50 border rounded-lg text-[0.7em] font-mono">
            <div className="flex items-center gap-2">
              <button onClick={goToFirstPage} disabled={pageIndex <= 1} className="px-2 py-1 border rounded disabled:opacity-40">
                ⏮
              </button>
              <button onClick={jumpBackTenPages} disabled={pageIndex <= 10} className="px-2 py-1 border rounded disabled:opacity-40">
                −10
              </button>
              <button onClick={goToPreviousPage} disabled={pageIndex <= 1} className="px-2 py-1 border rounded disabled:opacity-40">
                ←
              </button>
            </div>
            
            <div className="flex items-center gap-2">
              <span>Page {pageIndex} of {totalPages}</span>
              {currentPageRangeLabel && (
                <span className="text-gray-500">({currentPageRangeLabel})</span>
              )}
              <MonoSelect
                value={String(pageSize)}
                onChange={(v) => setPageSize(Number(v))}
                options={PAGE_SIZE_OPTIONS.map((s) => ({ value: String(s), label: `${s} per page` }))}
                size="sm"
              />
            </div>
            
            <div className="flex items-center gap-2">
              <button onClick={goToNextPage} disabled={pageIndex >= totalPages} className="px-2 py-1 border rounded disabled:opacity-40">
                →
              </button>
              <button onClick={jumpForwardTenPages} disabled={pageIndex + 10 > totalPages} className="px-2 py-1 border rounded disabled:opacity-40">
                +10
              </button>
              <button onClick={goToLastPage} disabled={pageIndex >= totalPages} className="px-2 py-1 border rounded disabled:opacity-40">
                ⏭
              </button>
            </div>
          </div>
        )}
        
        {/* Empty Results */}
        {!hasResults && (
          <div className="text-center py-12 text-gray-500 font-mono text-sm">
            No images match the current filters.
            {hasActiveFilters && (
              <button onClick={clearFilters} className="ml-2 text-blue-600 hover:underline">
                Clear filters
              </button>
            )}
          </div>
        )}
        
        {/* Image Grid / List */}
        {hasResults && viewMode === 'grid' && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {pageImages.map((image) => (
              <ImageCard
                key={image.id}
                image={image}
                selectedVariant={selectedVariant}
                respectAspectRatio={respectAspectRatio}
                isSelected={selectedImageIds.has(image.id)}
                bulkSelectionMode={bulkSelectionMode}
                isDuplicate={duplicateIds.has(image.id)}
                variationChildren={childrenMap[image.id]}
                familySummary={familySummaryMap[image.id]}
                colorMetadata={colorMetadataMap[image.id]}
                embeddingPending={embeddingPendingMap[image.id]}
                favoriteLoading={favoriteLoadingMap[image.id] ?? false}
                onToggleSelection={toggleSelection}
                onStartEdit={startEdit}
                onDelete={handleDeleteConfirm}
                onToggleFavorite={toggleFavorite}
                onCopyUrl={handleCopyUrl}
                onCopyNamespace={handleCopyNamespace}
                onSelectColor={() => {}}
                onMouseEnter={handleMouseEnter}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
              />
            ))}
          </div>
        )}
        
        {hasResults && viewMode === 'list' && (
          <div className="space-y-2">
            {pageImages.map((image) => (
              <ImageListItem
                key={image.id}
                image={image}
                selectedVariant={selectedVariant}
                isSelected={selectedImageIds.has(image.id)}
                bulkSelectionMode={bulkSelectionMode}
                isDuplicate={duplicateIds.has(image.id)}
                variationChildren={childrenMap[image.id]}
                familySummary={familySummaryMap[image.id]}
                colorMetadata={colorMetadataMap[image.id]}
                altLoading={altLoadingMap[image.id] ?? false}
                displayNameLoading={displayNameLoadingMap[image.id] ?? false}
                favoriteLoading={favoriteLoadingMap[image.id] ?? false}
                onToggleSelection={toggleSelection}
                onStartEdit={startEdit}
                onDelete={handleDeleteConfirm}
                onGenerateAlt={generateAltTag}
                onGenerateDisplayName={generateDisplayName}
                onToggleFavorite={toggleFavorite}
                onCopyUrl={handleCopyUrl}
                onCopyNamespace={handleCopyNamespace}
                onSelectColor={() => {}}
                onMouseEnter={handleMouseEnter}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
              />
            ))}
          </div>
        )}
        
        {/* Pagination (Bottom) */}
        {showPagination && (
          <div className="flex items-center justify-center gap-3 p-2 bg-gray-50 border rounded-lg text-[0.7em] font-mono">
            <button onClick={goToPreviousPage} disabled={pageIndex <= 1} className="px-3 py-1 border rounded disabled:opacity-40">
              ← Previous
            </button>
            <span>Page {pageIndex} of {totalPages}</span>
            <button onClick={goToNextPage} disabled={pageIndex >= totalPages} className="px-3 py-1 border rounded disabled:opacity-40">
              Next →
            </button>
          </div>
        )}
        
        <ImageGalleryModalStack
          images={images}
          copyMenuImageId={copyMenuImageId}
          onCloseCopyMenu={() => setCopyMenuImageId(null)}
          onToast={toast.push}
          editingImage={editingImage}
          editTags={editTags}
          onEditTagsChange={setEditTags}
          onSaveEdit={saveEdit}
          onCancelEdit={cancelEdit}
          onGenerateAltTag={generateAltTag}
          altLoadingMap={altLoadingMap}
          bulkEditOpen={bulkEditOpen}
          selectedCount={selectedCount}
          folders={uniqueFolders}
          namespaceOptions={namespaceOptions}
          onApplyBulkUpdates={applyBulkUpdates}
          onCloseBulkEdit={closeBulkEditModal}
          bulkUpdating={bulkUpdating}
          onCreateBulkAnimation={async (options) => {
            await createBulkAnimation({
              fps: options.fps.toString(),
              loop: options.loop,
              filename: options.filename,
            });
          }}
          bulkAnimateLoading={bulkAnimateLoading}
          bulkAnimateError={bulkAnimateError}
          deleteConfirmId={deleteConfirmId}
          onConfirmDelete={handleDeleteImage}
          onCancelDelete={() => setDeleteConfirmId(null)}
          namespaceSettingsOpen={namespaceSettingsOpen}
          registryNamespaces={registryNamespaces}
          currentNamespace={namespace || ''}
          onNamespaceChange={onNamespaceChange}
          onCloseNamespaceSettings={() => setNamespaceSettingsOpen(false)}
          hoveredImage={hoveredImage}
          showPreview={showPreview}
          mousePosition={mousePosition}
          onClosePreview={handleMouseLeave}
        />
      </div>
    );
  }
);

ImageGallery.displayName = 'ImageGallery';

export default ImageGallery;
export { ImageGallery };
