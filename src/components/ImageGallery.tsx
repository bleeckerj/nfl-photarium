'use client';

import { useState, useEffect, forwardRef, useMemo, useRef, useCallback } from 'react';
import { type CloudflareImage, type GalleryFamilySummary, type GridSize, type ImageGalleryProps, type ImageGalleryRef } from './gallery/types';
import { setDragPayloadForImage } from '@/utils/imageDrag';
import { copyToClipboard, formatCopyPayload } from '@/utils/clipboard';
import { useToast } from './Toast';
import { downloadImageToFile, formatDownloadFileName } from '@/utils/downloadUtils';
import { useGalleryReturnNavigation } from './gallery/hooks/useGalleryReturnNavigation';
import { useGallerySelection } from './gallery/hooks/useGallerySelection';
import { useGalleryControlsVisibility } from './gallery/hooks/useGalleryControlsVisibility';
import { useGalleryFilters } from './gallery/hooks/useGalleryFilters';
import { useGalleryItemActions } from './gallery/hooks/useGalleryItemActions';
import { useGalleryBulkActions } from './gallery/hooks/useGalleryBulkActions';
import { useGalleryBulkUiState } from './gallery/hooks/useGalleryBulkUiState';
import { useGalleryBulkState } from './gallery/hooks/useGalleryBulkState';
import { useGalleryAudit } from './gallery/hooks/useGalleryAudit';
import { useGalleryBackup } from './gallery/hooks/useGalleryBackup';
import { useGalleryEmbedding } from './gallery/hooks/useGalleryEmbedding';
import { useGalleryFavoriteToggle } from './gallery/hooks/useGalleryFavoriteToggle';
import { useGalleryDeleteConfirmation } from './gallery/hooks/useGalleryDeleteConfirmation';
import { useGalleryFocusNavigation } from './gallery/hooks/useGalleryFocusNavigation';
import { rememberGalleryResponseSnapshot, useGalleryInitialLoadState } from './gallery/hooks/useGalleryInitialLoadState';
import { useGalleryMetadataEffects } from './gallery/hooks/useGalleryMetadataEffects';
import { useGalleryNamespaceLifecycle } from './gallery/hooks/useGalleryNamespaceLifecycle';
import { useGalleryNamespace } from './gallery/hooks/useGalleryNamespace';
import { useGalleryPreferencePersistence } from './gallery/hooks/useGalleryPreferencePersistence';
import { useGalleryColorActions, useGalleryResultCounts, useGalleryViewFilters } from './gallery/hooks/useGalleryPresentationState';
import { useGalleryRefreshLifecycle } from './gallery/hooks/useGalleryRefreshLifecycle';
import { useGalleryReturnState } from './gallery/hooks/useGalleryReturnState';
import { useGalleryVideoExpansion } from './gallery/hooks/useGalleryVideoExpansion';
import { GalleryShell } from './gallery/GalleryShell';
import { GalleryLoadingState } from './gallery/GalleryLoadingState';
import { normalizeColorSearchHex, resolveColorSearchAssets, type ColorSearchResultRow } from './gallery/colorSearch';
import { DEFAULT_GRID_SIZE, VARIANT_OPTIONS } from './gallery/constants';
import { normalizeGridSize } from './gallery/gridSizing';
import { toDateKey } from './gallery/dateFilter';
import { collectFacetFolders, collectImageFolders, mergeFolderNames } from './gallery/folderOptions';
import { loadHiddenNamespaces } from './gallery/storage';
import { getKnownNamespaces } from './gallery/namespaceVisibility';
import { useSearchParams } from 'next/navigation';
import { isLikelySourceSearchTerm } from '@/utils/galleryFilter';
import { getUserVisibleTags } from '@/utils/systemTags';
import { buildGalleryImagesUrl, resolveGalleryRefreshServerQuery, type GalleryServerQueryState } from './gallery/galleryImagesUrl';
import {
  dedupeGalleryImages, formatVideoResultsNotice, parseGalleryServerFamilySummaryMap,
  parseGalleryServerFocus, parseGalleryServerPagination, parseGalleryVideoMeta,
  type GalleryDuplicateSummary, type GalleryServerFacets, type GalleryServerFocus,
  type GalleryServerPagination, type VideoMetaState,
} from './gallery/serverState';
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from './gallery/storedPreferences';

export { buildGalleryImagesUrl } from './gallery/galleryImagesUrl';
export {
  getDefaultStoredPreferences,
  getStoredPreferences,
  neutralizeStoredPreferenceFilters,
} from './gallery/storedPreferences';
export type { ImageGalleryRef } from './gallery/types';

const getBrowserDateTimeZone = () => {
  if (typeof window === 'undefined' || typeof Intl === 'undefined') return undefined;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
};

const ImageGallery = forwardRef<ImageGalleryRef, ImageGalleryProps>(
  ({ refreshTrigger, namespace, onNamespaceChange }, ref) => {
  const galleryUrlSearchParams = useSearchParams();
  const {
    initialFocusTargetRef,
    initialGalleryReturnStateRef,
    storedPreferencesRef,
    returningFromDetailRef,
    initialSilentFetchRef,
    deferInitialFetchRef,
    initialImages,
    initialLoading,
  } = useGalleryInitialLoadState({ namespace, galleryUrlSearchParams });

  const [images, setImages] = useState<CloudflareImage[]>(initialImages);
  const [loading, setLoading] = useState(initialLoading);
  const [selectedVariant, setSelectedVariant] = useState<string>(storedPreferencesRef.current.variant);
  const [openCopyMenu, setOpenCopyMenu] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>((storedPreferencesRef.current.viewMode ?? 'grid') as 'grid' | 'list');
  const [gridSize, setGridSize] = useState<GridSize>(
    normalizeGridSize(storedPreferencesRef.current.gridSize, DEFAULT_GRID_SIZE)
  );
  const [filtersCollapsed, setFiltersCollapsed] = useState(storedPreferencesRef.current.filtersCollapsed ?? false);
  const [showCli, setShowCli] = useState(storedPreferencesRef.current.showCli ?? true);
  const {
    controlsVisiblePreference,
    galleryControlsVisible,
    openSemanticSearch,
    semanticSearchRef,
    toggleGalleryControls,
  } = useGalleryControlsVisibility(storedPreferencesRef.current.controlsVisible ?? true);
  const {
    bulkSelectionMode, bulkEditOpen, bulkFolderInput, bulkFolderMode, bulkTagsInput, bulkTagsAiCount,
    bulkApplyFolder, bulkApplyTags, bulkTagsMode, bulkApplyDisplayName, bulkDisplayNameMode,
    bulkDisplayNameInput, bulkApplyDescription, bulkDescriptionAppendInput, bulkApplyNamespace,
    bulkNamespaceInput, bulkUpdating, bulkDeleting, bulkEmbeddingGenerating, bulkAnimateFps,
    bulkAnimateTouched, bulkAnimateLoop, bulkAnimateOrderMode, bulkAnimateNamespaceInput, bulkAnimateFilename, bulkAnimateLoading,
    bulkAnimateError, dispatchBulk, setBulkSelectionMode, setBulkEditOpen, setBulkFolderInput,
    setBulkFolderMode, setBulkTagsInput, setBulkTagsAiCount, setBulkApplyFolder, setBulkApplyTags,
    setBulkTagsMode, setBulkApplyDisplayName, setBulkDisplayNameMode, setBulkDisplayNameInput,
    setBulkApplyDescription, setBulkDescriptionAppendInput, setBulkApplyNamespace, setBulkNamespaceInput,
    setBulkUpdating, setBulkDeleting, setBulkEmbeddingGenerating, setBulkAnimateFps, setBulkAnimateTouched,
    setBulkAnimateLoop, setBulkAnimateOrderMode, setBulkAnimateNamespaceInput, setBulkAnimateFilename, setBulkAnimateLoading, setBulkAnimateError,
  } = useGalleryBulkState({
    bulkFolderInput: storedPreferencesRef.current.bulkFolderInput ?? '',
    bulkFolderMode: (storedPreferencesRef.current.bulkFolderMode ?? 'existing') as 'existing' | 'new',
  });

  const [refreshingCache, setRefreshingCache] = useState(false);
  const toast = useToast();
  const {
    namespaceSettingsOpen, setNamespaceSettingsOpen, namespaceDeleting, namespaceDraft,
    namespaceRenaming, namespaceRenameTarget, setNamespaceRenameTarget,
    namespaceSelectValue, registryNamespaces, fetchNamespaces, registerNamespace,
    namespaceOptions, namespaceLabel, handleNamespaceSelectChange, handleNamespaceDraftChange,
    selectedNamespaceForDelete, canDeleteSelectedNamespace, canRenameSelectedNamespace,
    handleNamespaceSave, handleNamespaceDelete, handleNamespaceRename,
  } = useGalleryNamespace({
    images,
    namespace,
    onNamespaceChange,
    toastPush: toast.push,
  });

  const [videoLimitOverride, setVideoLimitOverride] = useState<number | null>(null);
  const [includeExtrasForGallery, setIncludeExtrasForGallery] = useState(
    isLikelySourceSearchTerm(storedPreferencesRef.current.searchTerm ?? '')
  );
  const [videoMeta, setVideoMeta] = useState<VideoMetaState>(null);
  const [serverPagination, setServerPagination] = useState<GalleryServerPagination | null>(null);
  const [serverFocus, setServerFocus] = useState<GalleryServerFocus>(null);
  const [serverFacets, setServerFacets] = useState<GalleryServerFacets | null>(null);
  const [serverFamilySummaryMap, setServerFamilySummaryMap] = useState<Record<string, GalleryFamilySummary>>({});
  const [serverDuplicateSummary, setServerDuplicateSummary] = useState<GalleryDuplicateSummary | null>(null);
  const [catalogVersion, setCatalogVersion] = useState<number | null>(null);
  const [dismissedDuplicateSignature, setDismissedDuplicateSignature] = useState<string | null>(null);
  const [videoResultsNotice, setVideoResultsNotice] = useState<string | null>(null);
  const [colorSearchHex, setColorSearchHex] = useState<string | null>(
    normalizeColorSearchHex(storedPreferencesRef.current.colorSearchHex ?? null)
  );
  const [colorSearchRows, setColorSearchRows] = useState<ColorSearchResultRow[]>([]);
  const [colorSearchLoading, setColorSearchLoading] = useState(false);
  const [colorSearchError, setColorSearchError] = useState<string | null>(null);
  const [colorMetadataMap, setColorMetadataMap] = useState<Record<string, { dominantColors?: string[]; averageColor?: string }>>({});
  const [promptThisMap, setPromptThisMap] = useState<Record<string, string | null>>({});
  const promptThisMapRef = useRef<Record<string, string | null>>({});
  const requestedColorIdsRef = useRef<Map<string, number>>(new Map());
  const requestedPromptIdsRef = useRef<Map<string, number>>(new Map());
  const ENABLE_COLOR_METADATA = process.env.NEXT_PUBLIC_ENABLE_COLOR_METADATA === '1';
  const didRestoreReturnStateRef = useRef(false);
  const focusAppliedRef = useRef(false);
  // Set true to skip the next refetch that would otherwise be triggered by a
  // currentPage change. Used during focus reconciliation: the server's first
  // response already returned the focus page's data, so when we sync the client
  // currentPage to match serverFocus.page, there's no reason to refetch.
  const focusReconcileSkipRef = useRef(false);

  useGalleryReturnNavigation({
    initialGalleryReturnStateRef,
    didRestoreReturnStateRef,
    loading,
    namespace,
  });

  const [editingImage, setEditingImage] = useState<string | null>(null);
  const [editTags, setEditTags] = useState<string>('');
  const [editFolderSelect, setEditFolderSelect] = useState<string>('');
  const [newEditFolder, setNewEditFolder] = useState<string>('');
  const [altLoadingMap, setAltLoadingMap] = useState<Record<string, boolean>>({});
  const [displayNameLoadingMap, setDisplayNameLoadingMap] = useState<Record<string, boolean>>({});
  const [favoriteLoadingMap, setFavoriteLoadingMap] = useState<Record<string, boolean>>({});
  
  // Hover preview state
  const [hoveredImage, setHoveredImage] = useState<string | null>(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [showPreview, setShowPreview] = useState(false);
  const [utilityExpanded, setUtilityExpanded] = useState(false);
  const [semanticSearchAvailable, setSemanticSearchAvailable] = useState(false);
  const galleryTopRef = useRef<HTMLDivElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const showMotionAssetsOnlyRef = useRef(storedPreferencesRef.current.showMotionAssetsOnly ?? false);
  const galleryServerQueryRef = useRef<GalleryServerQueryState>({
    page: storedPreferencesRef.current.currentPage ?? 1,
    pageSize: storedPreferencesRef.current.pageSize ?? DEFAULT_PAGE_SIZE,
    search: storedPreferencesRef.current.searchTerm ?? '',
    folder: storedPreferencesRef.current.selectedFolder ?? 'all',
    tag: storedPreferencesRef.current.selectedTag ?? '',
    onlyCanonical: storedPreferencesRef.current.onlyCanonical,
    onlyWithVariants: storedPreferencesRef.current.onlyWithVariants,
    favorites: storedPreferencesRef.current.showFavoritesOnly ?? false,
    duplicates: storedPreferencesRef.current.showDuplicatesOnly ?? false,
    comfy: storedPreferencesRef.current.showComfyOnly ?? false,
    embedding: storedPreferencesRef.current.embeddingFilter ?? 'none',
    aspectRatioFilters: storedPreferencesRef.current.aspectRatioFilters ?? [],
    dateFilter: storedPreferencesRef.current.dateFilter ?? null,
    dateTimeZone: getBrowserDateTimeZone(),
    hiddenFolders: storedPreferencesRef.current.hiddenFolders ?? [],
    hiddenTags: storedPreferencesRef.current.hiddenTags ?? [],
    hiddenNamespaces: loadHiddenNamespaces(),
    showMotionAssetsOnly: storedPreferencesRef.current.showMotionAssetsOnly ?? false,
  });
  const didInitServerQueryFetchRef = useRef(false);
  const PERF_LOGGING_ENABLED = process.env.NODE_ENV !== 'production';

  const scrollToUploader = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const uploaderSection = document.getElementById('uploader-section');
    if (uploaderSection) {
      uploaderSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const fetchImages = useCallback(async ({
    silent = false,
    forceRefresh = false,
    syncNamespaces = false,
    firstPage = false,
    serverQuery: serverQueryOverride,
  }: { silent?: boolean; forceRefresh?: boolean; syncNamespaces?: boolean; firstPage?: boolean; serverQuery?: GalleryServerQueryState } = {}) => {
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    if (!silent) {
      setLoading(true);
    }
    if (forceRefresh) {
      setRefreshingCache(true);
    }
    try {
      const focusTarget = initialFocusTargetRef.current;
      const focusAssetId = focusTarget && !focusAppliedRef.current ? focusTarget.assetId : undefined;
      const effectiveServerQuery = resolveGalleryRefreshServerQuery(
        serverQueryOverride ?? galleryServerQueryRef.current,
        { firstPage }
      );
      const url = buildGalleryImagesUrl({
        forceRefresh,
        namespace,
        videoLimitOverride,
        includeExtrasForGallery,
        showMotionAssetsOnly: showMotionAssetsOnlyRef.current,
        serverQuery: effectiveServerQuery,
        focusAssetId,
      });
      // 'no-cache' (not 'no-store') lets the browser revalidate with
      // If-None-Match; the server answers 304 when nothing changed and the
      // cached body is served transparently.
      const response = await fetch(url, { signal: controller.signal, cache: 'no-cache' });
      const data = await response.json();
      if (response.ok) {
        const uniqueImages = dedupeGalleryImages(data.images || []);
        setImages(uniqueImages);
        setServerPagination(parseGalleryServerPagination(data?.pagination));
        setServerFacets(data?.facets && typeof data.facets === 'object' ? data.facets : null);
        setServerFamilySummaryMap(parseGalleryServerFamilySummaryMap(data?.familySummaryMap));
        setServerDuplicateSummary(data?.duplicateSummary && typeof data.duplicateSummary === 'object' ? data.duplicateSummary : null);
        setServerFocus(parseGalleryServerFocus(data?.focus));
        const nextVideoMeta = parseGalleryVideoMeta(data?.videoMeta);
        setVideoMeta(nextVideoMeta);
        setVideoResultsNotice(formatVideoResultsNotice(nextVideoMeta));
        setCatalogVersion(rememberGalleryResponseSnapshot({
          namespace: namespace ?? '', images: uniqueImages, response,
          pagination: data?.pagination,
          query: effectiveServerQuery ?? galleryServerQueryRef.current,
        }));
        if (PERF_LOGGING_ENABLED) {
          const elapsedMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt;
          const serverTiming = response.headers.get('server-timing') ?? 'n/a';
          const stageTiming = data?.timings ? JSON.stringify(data.timings) : '{}';
          console.info(
            `[GalleryPerf] /api/images ${Math.round(elapsedMs)}ms (silent=${silent}, refresh=${forceRefresh}, count=${uniqueImages.length}, total=${data?.pagination?.total ?? uniqueImages.length}) server_timing=${serverTiming} stages=${stageTiming}`
          );
        }
        if (syncNamespaces || forceRefresh) {
          void fetchNamespaces('no-cache');
        }
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      console.error('Failed to fetch images:', error);
      setServerFocus(null);
    } finally {
      if (abortControllerRef.current === controller) {
        setLoading(false);
        if (forceRefresh) {
          setRefreshingCache(false);
        }
      }
    }
  }, [
    fetchNamespaces,
    focusAppliedRef,
    includeExtrasForGallery,
    initialFocusTargetRef,
    namespace,
    PERF_LOGGING_ENABLED,
    videoLimitOverride,
  ]);

  const handleFoldersChanged = async () => {
    await fetchImages({ silent: true });
  };

  const clearColorSearch = useCallback(() => {
    setColorSearchHex(null);
    setColorSearchRows([]);
    setColorSearchError(null);
    setColorSearchLoading(false);
  }, []);

  const {
    backupLoading,
    backupError,
    backupAgeLabel,
    backupTimeLabel,
    backupSizeLabel,
    handleCreateBackup,
  } = useGalleryBackup(toast.push);

  const {
    brokenAudit,
    brokenImageIds,
    auditLoading,
    auditProgress,
    auditEntries,
    runBrokenAudit,
  } = useGalleryAudit({
    images,
    selectedVariant,
    toast,
  });

  const { embeddingPendingMap } = useGalleryEmbedding({
    images,
  });

  const handleCopyUrl = async (
    event: React.MouseEvent<HTMLButtonElement>,
    url: string,
    label?: string,
    altText?: string
  ) => {
    const payload = formatCopyPayload(url, altText, event.shiftKey);
    await copyToClipboard(payload, label, toast.push);
  };

  const handleOpenCopyMenu = useCallback((id: string) => {
    const target = images.find((image) => image.id === id);
    if (target?.assetType === 'video') {
      const videoUrl = target.videoPlaybackUrl || target.videoHlsUrl || target.videoThumbnailUrl;
      if (!videoUrl) {
        toast.push('No video URL available');
        return;
      }
      void copyToClipboard(videoUrl, 'Video URL', toast.push);
      return;
    }
    setOpenCopyMenu((prev) => (prev === id ? null : id));
  }, [images, toast]);

  const downloadVariantToFile = async (url: string, filenameHint?: string) => {
    try {
      const downloadName = formatDownloadFileName(filenameHint);
      await downloadImageToFile(url, downloadName);
      toast.push('Download started');
    } catch (error) {
      console.error('Failed to download image', error);
      toast.push('Failed to download image');
    }
  };

  // Hover preview handlers
  const handleMouseEnter = (imageId: string, event: React.MouseEvent) => {
    if (!(event.nativeEvent as MouseEvent).shiftKey) {
      setShowPreview(false);
      return;
    }
    setHoveredImage(imageId);
    setMousePosition({ x: event.clientX, y: event.clientY });
    setShowPreview(true);
  };

  const handleMouseMove = (imageId: string, event: React.MouseEvent) => {
    if (!(event.nativeEvent as MouseEvent).shiftKey) {
      setShowPreview(false);
      return;
    }
    if (hoveredImage !== imageId) {
      setHoveredImage(imageId);
    }
    setMousePosition({ x: event.clientX, y: event.clientY });
    setShowPreview(true);
  };

  const handleMouseLeave = () => {
    setHoveredImage(null);
    setShowPreview(false);
  };

  const imagesWithPrompts = useMemo(() => {
    if (Object.keys(promptThisMap).length === 0) {
      return images;
    }
    return images.map((img) => ({
      ...img,
      promptThis: promptThisMap[img.id] ?? undefined
    }));
  }, [images, promptThisMap]);

  const colorSearchResults = useMemo(
    () => resolveColorSearchAssets(colorSearchRows, imagesWithPrompts),
    [colorSearchRows, imagesWithPrompts]
  );

  const galleryImages = useMemo(
    () => (colorSearchHex ? colorSearchResults : imagesWithPrompts),
    [colorSearchHex, colorSearchResults, imagesWithPrompts]
  );

  const {
    selectedFolder, setSelectedFolder, selectedTag, setSelectedTag, searchTerm, setSearchTerm,
    onlyCanonical, setOnlyCanonical, respectAspectRatio, setRespectAspectRatio, onlyWithVariants,
    setOnlyWithVariants, showMotionAssetsOnly, setShowMotionAssetsOnly, showFavoritesOnly,
    setShowFavoritesOnly, showComfyOnly, setShowComfyOnly, showDuplicatesOnly, setShowDuplicatesOnly,
    showBrokenOnly, setShowBrokenOnly, embeddingFilter, setEmbeddingFilter, aspectRatioFilters,
    setAspectRatioFilters, dateFilter, setDateFilter, hiddenFolders, hiddenTags, hiddenNamespaces,
    hideFolderByName, unhideFolderByName, clearHiddenFolders, hideTagByName, unhideTagByName,
    clearHiddenTags, hideNamespaceByName, unhideNamespaceByName, clearHiddenNamespaces,
    filteredImages, filteredWithVariants, sortedImages, duplicateGroups, duplicateIds, childrenMap,
    familySummaryMap, hasActiveFilters, clearFilters, currentPage, pageSize, setPageSize, totalPages,
    pageImages, showPagination, hasResults, pageIndex, currentPageRangeLabel, prevPageRangeLabel,
    nextPageRangeLabel, setCurrentPage, goToPageNumber, goToPreviousPage, goToNextPage, goToFirstPage,
    goToLastPage, jumpBackTenPages, jumpForwardTenPages, scrollGalleryToTop,
  } = useGalleryFilters({
    images: galleryImages,
    familySourceImages: imagesWithPrompts,
    serverPagination: colorSearchHex ? null : serverPagination,
    serverFamilySummaryMap: colorSearchHex ? undefined : serverFamilySummaryMap,
    serverDuplicateIds: colorSearchHex ? undefined : serverDuplicateSummary?.pageDuplicateIds,
    initialPreferences: {
      selectedFolder: storedPreferencesRef.current.selectedFolder ?? 'all',
      selectedTag: storedPreferencesRef.current.selectedTag ?? '',
      searchTerm: storedPreferencesRef.current.searchTerm ?? '',
      onlyCanonical: storedPreferencesRef.current.onlyCanonical,
      respectAspectRatio: storedPreferencesRef.current.respectAspectRatio,
      onlyWithVariants: storedPreferencesRef.current.onlyWithVariants,
      showMotionAssetsOnly: storedPreferencesRef.current.showMotionAssetsOnly ?? false,
      showFavoritesOnly: storedPreferencesRef.current.showFavoritesOnly ?? false,
      showComfyOnly: storedPreferencesRef.current.showComfyOnly ?? false,
      embeddingFilter: storedPreferencesRef.current.embeddingFilter ?? 'none',
      showDuplicatesOnly: storedPreferencesRef.current.showDuplicatesOnly ?? false,
      showBrokenOnly: storedPreferencesRef.current.showBrokenOnly ?? false,
      aspectRatioFilters: storedPreferencesRef.current.aspectRatioFilters ?? [],
      dateFilter: storedPreferencesRef.current.dateFilter ?? null,
      hiddenFolders: storedPreferencesRef.current.hiddenFolders ?? [],
      hiddenTags: storedPreferencesRef.current.hiddenTags ?? [],
      hiddenNamespaces: storedPreferencesRef.current.hiddenNamespaces ?? loadHiddenNamespaces(),
      pageSize: storedPreferencesRef.current.pageSize ?? DEFAULT_PAGE_SIZE,
      currentPage: storedPreferencesRef.current.currentPage ?? 1,
    },
    brokenImageIds,
    isLoading: loading,
    returningFromDetailRef,
  });

  useGalleryRefreshLifecycle({
    fetchImages,
    imageCount: images.length,
    loading,
    perfLoggingEnabled: PERF_LOGGING_ENABLED,
    ref,
    refreshTrigger,
    resetToFirstPage: setCurrentPage,
    returningFromDetailRef,
    serverPagination,
  });

  const {
    focusedGalleryAssetId,
    focusNotice,
    setFocusNotice,
  } = useGalleryFocusNavigation({
    initialFocusTargetRef,
    namespace,
    clearFilters,
    clearColorSearch,
    galleryImages,
    filteredImages,
    loading,
    pageIndex,
    serverFocus,
    setCurrentPage,
    focusAppliedRef,
    focusReconcileSkipRef,
  });

  useGalleryNamespaceLifecycle({
    abortControllerRef,
    deferInitialFetchRef,
    fetchImages,
    initialGalleryReturnStateRef,
    initialSilentFetchRef,
    namespace,
    perfLoggingEnabled: PERF_LOGGING_ENABLED,
    requestedPromptIdsRef,
    setAspectRatioFilters,
    setOnlyCanonical,
    setPromptThisMap,
    setSearchTerm,
    setSelectedFolder,
    setSelectedTag,
    setServerFocus,
    setShowMotionAssetsOnly,
    setVideoLimitOverride,
    setVideoMeta,
    setVideoResultsNotice,
  });

  const hiddenFolderSet = useMemo(() => new Set(hiddenFolders), [hiddenFolders]);
  const hiddenTagSet = useMemo(() => new Set(hiddenTags.map(tag => tag.toLowerCase())), [hiddenTags]);
  const hiddenNamespacesForQuery = hiddenNamespaces;
  const shouldIncludeExtrasForSearch = useMemo(
    () => isLikelySourceSearchTerm(searchTerm),
    [searchTerm]
  );

  useEffect(() => {
    if (includeExtrasForGallery === shouldIncludeExtrasForSearch) return;
    setIncludeExtrasForGallery(shouldIncludeExtrasForSearch);
  }, [includeExtrasForGallery, shouldIncludeExtrasForSearch]);

  const serverGalleryQuery = useMemo<GalleryServerQueryState>(
    () => ({
      page: currentPage,
      pageSize,
      search: searchTerm,
      folder: selectedFolder,
      tag: selectedTag,
      onlyCanonical,
      onlyWithVariants,
      favorites: showFavoritesOnly,
      duplicates: showDuplicatesOnly,
      comfy: showComfyOnly,
      embedding: embeddingFilter,
      aspectRatioFilters,
      dateFilter,
      dateTimeZone: getBrowserDateTimeZone(),
      hiddenFolders,
      hiddenTags,
      hiddenNamespaces: hiddenNamespacesForQuery,
      showMotionAssetsOnly,
    }),
    [
      aspectRatioFilters,
      currentPage,
      dateFilter,
      embeddingFilter,
      hiddenFolders,
      hiddenTags,
      hiddenNamespacesForQuery,
      onlyCanonical,
      onlyWithVariants,
      pageSize,
      searchTerm,
      selectedFolder,
      selectedTag,
      showComfyOnly,
      showDuplicatesOnly,
      showFavoritesOnly,
      showMotionAssetsOnly,
    ]
  );
  const serverGalleryQueryKey = useMemo(() => JSON.stringify(serverGalleryQuery), [serverGalleryQuery]);

  useEffect(() => {
    galleryServerQueryRef.current = serverGalleryQuery;
    showMotionAssetsOnlyRef.current = serverGalleryQuery.showMotionAssetsOnly;
    if (!didInitServerQueryFetchRef.current) {
      didInitServerQueryFetchRef.current = true;
      return;
    }
    if (focusReconcileSkipRef.current) {
      focusReconcileSkipRef.current = false;
      return;
    }
    void fetchImages({ silent: true, serverQuery: serverGalleryQuery });
  }, [fetchImages, focusReconcileSkipRef, serverGalleryQueryKey, serverGalleryQuery]);

  const uniqueFolders = useMemo(() => {
    const selectedFolderValue =
      selectedFolder && selectedFolder !== 'all' && selectedFolder !== 'no-folder'
        ? [selectedFolder]
        : [];
    return mergeFolderNames(
      collectFacetFolders(serverFacets?.folders),
      collectImageFolders(images),
      hiddenFolders,
      selectedFolderValue,
      [bulkFolderInput, editFolderSelect]
    );
  }, [bulkFolderInput, editFolderSelect, hiddenFolders, images, selectedFolder, serverFacets]);
  const uniqueNamespaces = getKnownNamespaces(registryNamespaces, images, hiddenNamespaces);
  const handleFolderFilterChange = useCallback((folder: string) => {
    if (
      folder &&
      folder !== 'all' &&
      folder !== 'no-folder' &&
      hiddenFolderSet.has(folder)
    ) {
      unhideFolderByName(folder);
    }
    setSelectedFolder(folder);
  }, [hiddenFolderSet, setSelectedFolder, unhideFolderByName]);

  const { galleryReturnHrefSuffix, saveGalleryReturnState } = useGalleryReturnState({
    aspectRatioFilters, catalogVersion, colorSearchHex, currentPage, dateFilter, embeddingFilter, filteredImages,
    hiddenFolders, hiddenTags, hiddenNamespaces, namespace, onlyCanonical, onlyWithVariants, pageImages, pageSize,
    searchTerm, selectedFolder, selectedTag, showBrokenOnly, showComfyOnly, showDuplicatesOnly,
    showFavoritesOnly, showMotionAssetsOnly,
  });

  const { loadMoreVideos } = useGalleryVideoExpansion({
    currentPage, loading, namespace, setVideoLimitOverride, totalPages, videoMeta,
  });

  useGalleryMetadataEffects({
    colorSearchHex, enableColorMetadata: ENABLE_COLOR_METADATA, images, namespace, pageImages,
    promptThisMapRef, requestedColorIdsRef, requestedPromptIdsRef, searchTerm, setColorMetadataMap,
    setColorSearchError, setColorSearchLoading, setColorSearchRows, setImages, setPromptThisMap,
  });

  useGalleryPreferencePersistence({
    aspectRatioFilters, bulkFolderInput, bulkFolderMode, controlsVisiblePreference, currentPage,
    dateFilter, filtersCollapsed, gridSize, onlyCanonical, onlyWithVariants, pageSize,
    respectAspectRatio, searchTerm, selectedFolder, selectedTag, selectedVariant, showBrokenOnly,
    showCli, showComfyOnly, showDuplicatesOnly, showFavoritesOnly, showMotionAssetsOnly, viewMode,
  });

  const {
    selectedImageIds, selectedCount, toggleSelection, clearSelection, selectAllOnPage,
    selectDuplicateImages: selectDuplicateImagesBase, selectDuplicatesKeepSingle: selectDuplicatesKeepSingleBase,
  } = useGallerySelection({
    images, duplicateGroups, duplicateIds, serverDuplicateIds: serverDuplicateSummary?.allDuplicateIds,
    serverDuplicateIdsExcludingNewest: serverDuplicateSummary?.duplicateIdsExcludingNewest,
    serverDuplicateIdsExcludingOldest: serverDuplicateSummary?.duplicateIdsExcludingOldest,
    bulkSelectionMode, setBulkSelectionMode,
  });

  const selectDuplicateImages = useCallback(() => {
    const selected = selectDuplicateImagesBase();
    toast.push(selected ? 'Duplicate images selected' : 'No duplicates detected');
  }, [selectDuplicateImagesBase, toast]);

  const selectDuplicatesKeepSingle = useCallback(
    (strategy: 'newest' | 'oldest') => {
      const selected = selectDuplicatesKeepSingleBase(strategy);
      if (!selected) {
        toast.push('No duplicates detected');
        return;
      }
      toast.push(
        strategy === 'newest'
          ? 'Selected duplicates (keeping newest copy per duplicate group)'
          : 'Selected duplicates (keeping oldest copy per duplicate group)'
      );
    },
    [selectDuplicatesKeepSingleBase, toast]
  );

  const { deleteImage, generateAltTag, generateDisplayName, startEdit, cancelEdit, saveEdit } = useGalleryItemActions({
    images, setImages, toastPush: toast.push, setAltLoadingMap, setDisplayNameLoadingMap,
    editFolderSelect, newEditFolder, editTags, setEditingImage, setEditFolderSelect, setNewEditFolder, setEditTags,
  });
  const {
    deleteConfirmId,
    deleteConfirmDeleting,
    requestDeleteImage,
    cancelDeleteImage,
    confirmDeleteImage,
  } = useGalleryDeleteConfirmation(deleteImage);

  const toggleFavorite = useGalleryFavoriteToggle({
    images, setFavoriteLoadingMap, setImages, toastPush: toast.push,
  });

  const {
    applyBulkUpdates, createBulkAnimation, deleteSelectedImages, generateEmbeddingsForSelected,
  } = useGalleryBulkActions({
    images, setImages, toastPush: toast.push, selectedCount, selectedImageIds, clearSelection,
    setBulkSelectionMode, setBulkEditOpen, setBulkAnimateFilename, setBulkAnimateFps,
    setBulkAnimateLoop, setBulkAnimateOrderMode, setBulkAnimateTouched, bulkApplyFolder,
    bulkApplyTags, bulkFolderInput, bulkTagsInput, bulkTagsAiCount, bulkTagsMode,
    bulkApplyDisplayName, bulkDisplayNameInput, bulkDisplayNameMode, bulkApplyDescription,
    bulkDescriptionAppendInput, bulkApplyNamespace, bulkNamespaceInput, bulkFolderMode, setBulkUpdating,
    setBulkDeleting, setBulkEmbeddingGenerating, setBulkAnimateLoading, setBulkAnimateError,
    bulkAnimateFps, bulkAnimateFilename, bulkAnimateLoop, bulkAnimateOrderMode,
    bulkAnimateNamespaceInput, setBulkAnimateNamespaceInput, namespace, fetchImages,
  });

  const {
    bulkAnimateSelectionOrderDiffers, bulkFolderOptions, closeBulkEditModal, handleBulkFolderSelect,
    handleCopySelectionPayload, openBulkEditModal, selectedAnimationPreview, selectedImagesForPayload,
  } = useGalleryBulkUiState({
    bulkAnimateOrderMode, bulkAnimateTouched, dispatchBulk, images, selectedCount, selectedImageIds,
    setBulkAnimateFps, setBulkEditOpen, setBulkFolderInput, setBulkFolderMode, toastPush: toast.push, uniqueFolders,
  });

  const duplicateGroupCount = serverDuplicateSummary?.groupCount ?? duplicateGroups.length;
  const duplicateImageCount = serverDuplicateSummary?.imageCount ?? duplicateIds.size;
  const duplicateSignature = useMemo(() => {
    const ids = serverDuplicateSummary?.allDuplicateIds ?? Array.from(duplicateIds);
    return ids.length ? [...ids].sort().join('|') : null;
  }, [duplicateIds, serverDuplicateSummary?.allDuplicateIds]);
  const visibleDuplicateGroupCount = duplicateSignature === dismissedDuplicateSignature
    ? 0
    : duplicateGroupCount;

  const uniqueTags = useMemo(() => {
    if (serverFacets?.tags) {
      return serverFacets.tags.map((entry) => entry.value);
    }
    const tags = Array.from(
      new Set(images.flatMap(img => getUserVisibleTags(img.tags)))
    );
    return tags.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [images, serverFacets]);

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
      const uploaded = new Date(image.uploaded);
      if (Number.isNaN(uploaded.getTime())) return acc;
      return toDateKey(uploaded) === newestDateKey ? acc + 1 : acc;
    }, 0);

    setDateFilter({ startDate: newestDateKey, endDate: newestDateKey });
    return { dateKey: newestDateKey, count };
  }, [setDateFilter, sortedImages]);

  const editFolderOptions = useMemo(
    () => [
      { value: '', label: '[none]' },
      ...uniqueFolders.map(folder => ({ value: folder as string, label: folder as string })),
      { value: '__create__', label: 'Create new folder...' }
    ],
    [uniqueFolders]
  );
  const handlePageSizeChange = useCallback(
    (nextSize: number) => {
      const normalized = PAGE_SIZE_OPTIONS.includes(nextSize) ? nextSize : DEFAULT_PAGE_SIZE;
      setPageSize(normalized);
    },
    [setPageSize]
  );

  useEffect(() => {
    // A pending return-from-detail restore owns the scroll position; the smooth
    // scroll-to-top here would race the scrollY restore above and win.
    if (initialGalleryReturnStateRef.current && !didRestoreReturnStateRef.current) return;
    scrollGalleryToTop();
  }, [initialGalleryReturnStateRef, scrollGalleryToTop]);

  const viewFilters = useGalleryViewFilters({
    activeColorSearchHex: colorSearchHex,
    altLoadingMap,
    bulkSelectionMode,
    childrenMap,
    colorMetadataMap,
    displayNameLoadingMap,
    duplicateIds,
    embeddingPendingMap,
    familySummaryMap,
    favoriteLoadingMap,
    focusedGalleryAssetId,
    galleryReturnHrefSuffix,
    pageImages,
    respectAspectRatio,
    selectedImageIds,
    selectedVariant,
  });
  const { handleClearFilters, handleSelectColor } = useGalleryColorActions({
    clearColorSearch,
    clearFilters,
    goToFirstPage,
    scrollGalleryToTop,
    setColorSearchError,
    setColorSearchHex,
    setColorSearchRows,
  });
  const { galleryResultCount, galleryTotalCount } = useGalleryResultCounts({
    colorSearchHex,
    filteredWithVariants,
    images,
    serverPagination,
  });

  // Only blank to the skeleton when there is nothing to show; a hydrated grid
  // stays visible while a fetch is in flight (stale-while-revalidate).
  if (loading && images.length === 0) {
    return <GalleryLoadingState />;
  }

  return (
    <GalleryShell
      galleryTopRef={galleryTopRef}
      compactHeaderProps={{
        filteredCount: galleryResultCount, totalCount: galleryTotalCount, pageIndex, totalPages,
        namespaceLabel, controlsVisible: galleryControlsVisible, showSearchButton: semanticSearchAvailable,
        onToggleControls: toggleGalleryControls, onOpenSearch: openSemanticSearch,
      }}
      pagerStripProps={{
        pageIndex, totalPages, prevPageRangeLabel, nextPageRangeLabel, onFirstPage: goToFirstPage,
        onJumpBackTen: jumpBackTenPages, onPrevPage: goToPreviousPage, onNextPage: goToNextPage,
        onJumpForwardTen: jumpForwardTenPages, onLastPage: goToLastPage,
      }}
      noticeStackProps={{
        duplicateGroupCount: visibleDuplicateGroupCount, duplicateImageCount, showDuplicatesOnly, colorSearchHex, colorSearchLoading,
        colorSearchError, galleryResultCount, focusNotice,
        onToggleDuplicatesOnly: () => setShowDuplicatesOnly(!showDuplicatesOnly),
        onSelectDuplicateImages: selectDuplicateImages, onSelectDuplicatesKeepSingle: selectDuplicatesKeepSingle,
        onDismissDuplicates: () => setDismissedDuplicateSignature(duplicateSignature),
        onClearColorSearch: clearColorSearch, onDismissFocusNotice: () => setFocusNotice(null),
      }}
      controlsPanelProps={{
        visible: galleryControlsVisible, filtersCollapsed, semanticSearchRef, namespace,
        onSemanticAvailabilityChange: setSemanticSearchAvailable,
        legacyTopBarProps: {
          filteredCount: galleryResultCount, totalCount: galleryTotalCount, namespaceLabel, namespace,
          showPagination, currentPageRangeLabel, sortedImages, dateFilter, onDateFilterChange: setDateFilter,
          bulkSelectionMode, filtersCollapsed, hasActiveFilters, pageSize, pageSizeOptions: PAGE_SIZE_OPTIONS,
          defaultPageSize: DEFAULT_PAGE_SIZE, gridSize, refreshingCache, viewMode, selectedCount,
          bulkEmbeddingGenerating, bulkDeleting,
          onToggleBulkSelection: () => setBulkSelectionMode(!bulkSelectionMode),
          onToggleFilters: () => setFiltersCollapsed((prev) => !prev), onClearFilters: handleClearFilters,
          onPageSizeChange: handlePageSizeChange, onGridSizeChange: setGridSize, onRefreshCache: () => fetchImages({ forceRefresh: true }),
          onOpenNamespaceSettings: () => setNamespaceSettingsOpen(true),
          onToggleViewMode: () => setViewMode(viewMode === 'grid' ? 'list' : 'grid'),
          onSelectPage: () => selectAllOnPage(pageImages), onClearSelection: clearSelection,
          onOpenBulkEdit: openBulkEditModal, onGenerateEmbeddings: generateEmbeddingsForSelected,
          onDeleteSelected: deleteSelectedImages,
        },
        backupTimeLabel, backupSizeLabel, backupAgeLabel, backupError, backupLoading, onCreateBackup: handleCreateBackup,
        galleryFiltersProps: {
          searchTerm, onSearchChange: setSearchTerm, folders: uniqueFolders, selectedFolder,
          onFolderChange: handleFolderFilterChange, hiddenFolders: hiddenFolderSet,
          onToggleHiddenFolder: (folder: string) =>
            hiddenFolderSet.has(folder) ? unhideFolderByName(folder) : hideFolderByName(folder),
          onShowAllFolders: clearHiddenFolders, allTags: uniqueTags, selectedTag,
          onTagChange: setSelectedTag, hiddenTags: hiddenTagSet,
          onToggleHiddenTag: (tag: string) =>
            hiddenTagSet.has(tag.toLowerCase()) ? unhideTagByName(tag) : hideTagByName(tag),
          onShowAllTags: clearHiddenTags, aspectRatioFilters, onAspectRatioFiltersChange: setAspectRatioFilters,
          onlyCanonical, onOnlyCanonicalChange: setOnlyCanonical, respectAspectRatio,
          onRespectAspectRatioChange: setRespectAspectRatio, showDuplicatesOnly,
          onShowDuplicatesOnlyChange: setShowDuplicatesOnly, showVariationsOnly: onlyWithVariants,
          onShowVariationsOnlyChange: setOnlyWithVariants, showMotionAssetsOnly,
          onShowMotionAssetsOnlyChange: setShowMotionAssetsOnly, showFavoritesOnly,
          onShowFavoritesOnlyChange: setShowFavoritesOnly, showComfyOnly, onShowComfyOnlyChange: setShowComfyOnly,
          showOnlyMissingEmbeddings: embeddingFilter !== 'none',
          onShowOnlyMissingEmbeddingsChange: (value: boolean) =>
            setEmbeddingFilter(value ? 'missing-any' : 'none'),
          showBrokenOnly, onShowBrokenOnlyChange: setShowBrokenOnly, onClearFilters: handleClearFilters,
          hasActiveFilters: hasActiveFilters || Boolean(colorSearchHex),
        },
        auditLoading, auditEntries, auditProgress, showCli,
        commandBarProps: {
          hiddenFolders, hiddenTags, hiddenNamespaces, knownFolders: uniqueFolders, knownTags: uniqueTags,
          knownNamespaces: uniqueNamespaces,
          onHideFolder: hideFolderByName, onUnhideFolder: unhideFolderByName, onClearHidden: clearHiddenFolders,
          onHideTag: hideTagByName, onUnhideTag: unhideTagByName, onClearHiddenTags: clearHiddenTags,
          onHideNamespace: hideNamespaceByName, onUnhideNamespace: unhideNamespaceByName,
          onClearHiddenNamespaces: clearHiddenNamespaces,
          onSelectFolder: setSelectedFolder, selectedTag, onSelectTag: setSelectedTag,
          onClearTagFilter: () => setSelectedTag(''), showParentsOnly: onlyWithVariants,
          onSetParentsOnly: setOnlyWithVariants, showComfyOnly, onSetComfyOnly: setShowComfyOnly,
          currentPage: pageIndex, totalPages, onGoToPage: goToPageNumber, embeddingFilter,
          onSetEmbeddingFilter: setEmbeddingFilter, onShowLastUploaded: showLastUploaded,
          onClose: () => setShowCli(false),
        },
      }}
      utilityRailProps={{
        expanded: utilityExpanded, filtersCollapsed, showCli, videoResultsNotice, videoMeta, selectedCount,
        onExpandChange: setUtilityExpanded, onToggleFilters: () => setFiltersCollapsed((prev) => !prev),
        onToggleCli: () => setShowCli((prev) => !prev), onLoadMoreVideos: loadMoreVideos,
        onSelectPage: () => selectAllOnPage(pageImages), onOpenBulkEdit: openBulkEditModal,
        onClearSelection: clearSelection, onScrollTop: scrollGalleryToTop, onScrollToUploader: scrollToUploader,
      }}
      resultsRegionProps={{
        hasResults, galleryTotalCount, colorSearchHex, hasActiveFilters, viewMode, gridSize,
        viewFilters, selectedVariant, variantOptions: VARIANT_OPTIONS, namespace, auditLoading, auditProgress, brokenAudit,
        onClearFilters: handleClearFilters, onToggleSelection: toggleSelection, onBeforeNavigate: saveGalleryReturnState,
        onCopyNamespace: (ns) => { void copyToClipboard(ns, 'Namespace', toast.push); },
        onSelectColor: handleSelectColor, onToggleCopyMenu: handleOpenCopyMenu, onStartEdit: startEdit,
        onDelete: requestDeleteImage, onToggleFavorite: toggleFavorite, onGenerateAlt: generateAltTag,
        onGenerateDisplayName: generateDisplayName, onDragStart: (event, img) => setDragPayloadForImage(event, img),
        onMouseEnter: handleMouseEnter, onMouseMove: handleMouseMove, onMouseLeave: handleMouseLeave,
        onVariantChange: setSelectedVariant, onFoldersChanged: handleFoldersChanged, onRunBrokenAudit: runBrokenAudit,
      }}
      modalsProps={{
        images, openCopyMenu, onCloseCopyMenu: () => setOpenCopyMenu(null), onCopyUrl: handleCopyUrl, onDownload: downloadVariantToFile,
        namespaceModalOpen: namespaceSettingsOpen, namespaceSelectValue, namespaceDraft, namespaceOptions,
        onNamespaceSelectChange: handleNamespaceSelectChange, onNamespaceDraftChange: handleNamespaceDraftChange,
        onNamespaceCancel: () => setNamespaceSettingsOpen(false), onNamespaceSave: handleNamespaceSave,
        selectedNamespaceForDelete, canDeleteSelectedNamespace, deletingNamespace: namespaceDeleting,
        onDeleteNamespace: handleNamespaceDelete, namespaceRenameTarget,
        canRenameSelectedNamespace, renamingNamespace: namespaceRenaming,
        onNamespaceRenameTargetChange: setNamespaceRenameTarget,
        onRenameNamespace: handleNamespaceRename, editingImage, editFolderSelect, editFolderOptions,
        newEditFolder, editTags, onEditFolderSelect: setEditFolderSelect, onNewEditFolderChange: setNewEditFolder,
        onEditTagsChange: setEditTags, onEditCancel: cancelEdit,
        onEditSave: () => {
          if (editingImage) {
            void saveEdit(editingImage);
          }
        },
        deleteConfirmImageId: deleteConfirmId, deleteConfirmDeleting,
        onDeleteConfirm: confirmDeleteImage, onDeleteCancel: cancelDeleteImage,
        bulkEditOpen, selectedCount, selectedImagesForPayload, selectedAnimationPreview, bulkAnimateOrderMode,
        onBulkAnimateOrderModeChange: setBulkAnimateOrderMode, bulkAnimateSelectionOrderDiffers,
        onCopySelectionPayload: handleCopySelectionPayload, bulkApplyFolder, onBulkApplyFolderChange: setBulkApplyFolder,
        bulkFolderMode, bulkFolderInput, onBulkFolderInputChange: setBulkFolderInput, bulkFolderOptions,
        onBulkFolderSelect: handleBulkFolderSelect, bulkApplyTags, onBulkApplyTagsChange: setBulkApplyTags,
        bulkTagsMode, onBulkTagsModeChange: setBulkTagsMode, bulkTagsInput, onBulkTagsInputChange: setBulkTagsInput,
        bulkTagsAiCount, onBulkTagsAiCountChange: setBulkTagsAiCount, bulkApplyDisplayName,
        onBulkApplyDisplayNameChange: setBulkApplyDisplayName, bulkDisplayNameMode,
        onBulkDisplayNameModeChange: setBulkDisplayNameMode, bulkDisplayNameInput,
        onBulkDisplayNameInputChange: setBulkDisplayNameInput, bulkApplyDescription,
        onBulkApplyDescriptionChange: setBulkApplyDescription, bulkDescriptionAppendInput,
        onBulkDescriptionAppendInputChange: setBulkDescriptionAppendInput, bulkApplyNamespace,
        onBulkApplyNamespaceChange: setBulkApplyNamespace, bulkNamespaceInput, onBulkNamespaceInputChange: setBulkNamespaceInput,
        registryNamespaces, onRegisterNamespace: registerNamespace, bulkAnimateFps, onBulkAnimateFpsChange: setBulkAnimateFps,
        bulkAnimateTouched, onBulkAnimateTouchedChange: setBulkAnimateTouched, bulkAnimateLoop,
        onBulkAnimateLoopChange: setBulkAnimateLoop, bulkAnimateFilename, onBulkAnimateFilenameChange: setBulkAnimateFilename,
        bulkAnimateNamespaceInput, onBulkAnimateNamespaceInputChange: setBulkAnimateNamespaceInput,
        bulkAnimateLoading, bulkAnimateError, bulkUpdating, onBulkApply: applyBulkUpdates,
        onBulkCreateAnimation: createBulkAnimation, onBulkClose: closeBulkEditModal,
      }}
      hoverPreviewProps={
        hoveredImage && showPreview
          ? {
              imageId: hoveredImage,
              filename: images.find(img => img.id === hoveredImage)?.filename || 'Unknown',
              isVisible: showPreview,
              mousePosition,
              onClose: handleMouseLeave,
              dimensions: images.find(img => img.id === hoveredImage)?.dimensions,
            }
          : null
      }
    />
  );
});

ImageGallery.displayName = 'ImageGallery';

export default ImageGallery;
