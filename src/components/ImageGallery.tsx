'use client';

import { useState, useEffect, forwardRef, useImperativeHandle, useMemo, useRef, useCallback, useLayoutEffect } from 'react';
import {
  type CloudflareImage,
  type GalleryFamilySummary,
  type GridSize,
  type ImageGalleryProps,
  type ImageGalleryRef,
} from './gallery/types';
import { getMultipleImageUrls, IMAGE_VARIANTS } from '@/utils/imageUtils';
import { setDragPayloadForImage } from '@/utils/imageDrag';
import { copyToClipboard, formatCopyPayload } from '@/utils/clipboard';
import { useToast } from './Toast';
import HoverPreview from './HoverPreview';
import { downloadImageToFile, formatDownloadFileName } from '@/utils/downloadUtils';
import { GalleryCompactHeader } from '@/components/gallery/GalleryCompactHeader';
import GalleryControlsPanel from '@/components/gallery/GalleryControlsPanel';
import GalleryNoticeStack from '@/components/gallery/GalleryNoticeStack';
import { GalleryPagerStrip } from '@/components/gallery/GalleryPagerStrip';
import GalleryUtilityRail from '@/components/gallery/GalleryUtilityRail';
import { type GallerySemanticSearchRef } from '@/components/gallery/GallerySemanticSearch';
import { useGallerySelection } from './gallery/hooks/useGallerySelection';
import { useGalleryFilters } from './gallery/hooks/useGalleryFilters';
import { useGalleryItemActions } from './gallery/hooks/useGalleryItemActions';
import { useGalleryBulkActions } from './gallery/hooks/useGalleryBulkActions';
import { useGalleryBulkState } from './gallery/hooks/useGalleryBulkState';
import { useGalleryAudit } from './gallery/hooks/useGalleryAudit';
import { useGalleryBackup } from './gallery/hooks/useGalleryBackup';
import { useGalleryEmbedding } from './gallery/hooks/useGalleryEmbedding';
import { useGalleryFocusNavigation } from './gallery/hooks/useGalleryFocusNavigation';
import { rememberGalleryWarmCache, useGalleryInitialLoadState } from './gallery/hooks/useGalleryInitialLoadState';
import { useGalleryNamespace } from './gallery/hooks/useGalleryNamespace';
import { GalleryModals } from './gallery/GalleryModals';
import GalleryResultsRegion from './gallery/GalleryResultsRegion';
import { normalizeColorSearchHex, resolveColorSearchAssets, type ColorSearchResultRow } from './gallery/colorSearch';
import { DEFAULT_GRID_SIZE } from './gallery/constants';
import { normalizeGridSize } from './gallery/gridSizing';
import { toDateKey } from './gallery/dateFilter';
import { collectFacetFolders, collectImageFolders, mergeFolderNames } from './gallery/folderOptions';
import {
  clearGalleryReturnState,
  GALLERY_RETURN_SNAPSHOT_KEY,
  saveDetailAssetSeed,
  saveGalleryReturnState as persistGalleryReturnState,
} from './gallery/returnState';
import { useSearchParams } from 'next/navigation';
import { isLikelySourceSearchTerm } from '@/utils/galleryFilter';
import { patchImageFavorite } from '@/services/imageMetadataService';
import { getUserVisibleTags, hasFavoriteTag } from '@/utils/systemTags';
import { buildGalleryImagesUrl, type GalleryServerQueryState } from './gallery/galleryImagesUrl';
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
} from './gallery/storedPreferences';

export { buildGalleryImagesUrl } from './gallery/galleryImagesUrl';
export {
  getDefaultStoredPreferences,
  getStoredPreferences,
  neutralizeStoredPreferenceFilters,
} from './gallery/storedPreferences';
export type { ImageGalleryRef } from './gallery/types';

const VARIANT_DIMENSIONS = new Map(IMAGE_VARIANTS.map(variant => [variant.name, variant.width]));
const VIDEO_LIMIT_STEP = 150;
const COLOR_SEARCH_LIMIT = 100;
type VideoMetaState = {
  enabled: boolean;
  limit: number;
  returned: number;
  totalScoped: number;
  truncated: boolean;
} | null;

type GalleryServerPagination = {
  page: number;
  pageSize: number;
  scopeTotal?: number;
  total: number;
  totalPages: number;
};

type GalleryServerFocus = {
  assetId: string;
  found: boolean;
  index: number;
  ordinal: number;
  page: number;
  pageSize: number;
  total: number;
} | null;

type GalleryServerFacets = {
  folders: Array<{ value: string; count: number }>;
  tags: Array<{ value: string; count: number }>;
};

type GalleryDuplicateSummary = {
  groupCount: number;
  imageCount: number;
  pageDuplicateIds: string[];
  allDuplicateIds?: string[];
  duplicateIdsExcludingNewest?: string[];
  duplicateIdsExcludingOldest?: string[];
};

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
  const [controlsVisiblePreference, setControlsVisiblePreference] = useState(storedPreferencesRef.current.controlsVisible ?? true);
  const [galleryControlsVisible, setGalleryControlsVisible] = useState(storedPreferencesRef.current.controlsVisible ?? true);
  const {
    bulkSelectionMode,
    bulkEditOpen,
    bulkFolderInput,
    bulkFolderMode,
    bulkTagsInput,
    bulkTagsAiCount,
    bulkApplyFolder,
    bulkApplyTags,
    bulkTagsMode,
    bulkApplyDisplayName,
    bulkDisplayNameMode,
    bulkDisplayNameInput,
    bulkApplyDescription,
    bulkDescriptionAppendInput,
    bulkApplyNamespace,
    bulkNamespaceInput,
    bulkUpdating,
    bulkDeleting,
    bulkEmbeddingGenerating,
    bulkAnimateFps,
    bulkAnimateTouched,
    bulkAnimateLoop,
    bulkAnimateOrderMode,
    bulkAnimateFilename,
    bulkAnimateLoading,
    bulkAnimateError,
    dispatchBulk,
    setBulkSelectionMode,
    setBulkEditOpen,
    setBulkFolderInput,
    setBulkFolderMode,
    setBulkTagsInput,
    setBulkTagsAiCount,
    setBulkApplyFolder,
    setBulkApplyTags,
    setBulkTagsMode,
    setBulkApplyDisplayName,
    setBulkDisplayNameMode,
    setBulkDisplayNameInput,
    setBulkApplyDescription,
    setBulkDescriptionAppendInput,
    setBulkApplyNamespace,
    setBulkNamespaceInput,
    setBulkUpdating,
    setBulkDeleting,
    setBulkEmbeddingGenerating,
    setBulkAnimateFps,
    setBulkAnimateTouched,
    setBulkAnimateLoop,
    setBulkAnimateOrderMode,
    setBulkAnimateFilename,
    setBulkAnimateLoading,
    setBulkAnimateError,
  } = useGalleryBulkState({
    bulkFolderInput: storedPreferencesRef.current.bulkFolderInput ?? '',
    bulkFolderMode: (storedPreferencesRef.current.bulkFolderMode ?? 'existing') as 'existing' | 'new',
  });

  const [refreshingCache, setRefreshingCache] = useState(false);
  const toast = useToast();
  const {
    namespaceSettingsOpen,
    setNamespaceSettingsOpen,
    namespaceDeleting,
    namespaceDraft,
    namespaceSelectValue,
    registryNamespaces,
    fetchNamespaces,
    registerNamespace,
    namespaceOptions,
    namespaceLabel,
    handleNamespaceSelectChange,
    handleNamespaceDraftChange,
    selectedNamespaceForDelete,
    canDeleteSelectedNamespace,
    handleNamespaceSave,
    handleNamespaceDelete,
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
  const COLOR_METADATA_RETRY_MS = 5 * 60 * 1000;
  const PROMPT_THIS_RETRY_MS = 60 * 1000;
  const ENABLE_COLOR_METADATA = process.env.NEXT_PUBLIC_ENABLE_COLOR_METADATA === '1';
  const didRestoreReturnStateRef = useRef(false);

  // Restore scroll position when returning from a detail page.
  // Page is restored during initial state hydration to avoid a visible jump.
  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    if (didRestoreReturnStateRef.current) return;
    if (loading) return;
    const parsed = initialGalleryReturnStateRef.current;
    if (!parsed) return;
    const activeNamespace = namespace ?? '';
    if (parsed.namespace !== activeNamespace) return;

    didRestoreReturnStateRef.current = true;
    clearGalleryReturnState();
    window.sessionStorage.removeItem(GALLERY_RETURN_SNAPSHOT_KEY);

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.scrollTo({ top: parsed.scrollY, behavior: 'auto' });
      });
    });
  }, [loading, namespace]);

  // If we arrived via `/?gpage=...&gns=...`, clean up the URL once mounted.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const url = new URL(window.location.href);
      if (!url.searchParams.has('gpage') && !url.searchParams.has('gns') && !url.searchParams.has('gcolor')) return;
      url.searchParams.delete('gpage');
      url.searchParams.delete('gns');
      url.searchParams.delete('gcolor');
      window.history.replaceState(window.history.state, '', url.toString());
    } catch {
      // ignore
    }
  }, []);

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
  const [pendingSemanticSearchReveal, setPendingSemanticSearchReveal] = useState(false);
  const galleryTopRef = useRef<HTMLDivElement | null>(null);
  const semanticSearchRef = useRef<GallerySemanticSearchRef | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const initialLoadStartedAtRef = useRef<number>(typeof performance !== 'undefined' ? performance.now() : Date.now());
  const initialLoadLoggedRef = useRef(false);
  const videoAutoExpandPageRef = useRef<number | null>(null);
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

  const applyGalleryControlsVisibility = useCallback((controlsVisible: boolean) => {
    setGalleryControlsVisible((prev) => (prev === controlsVisible ? prev : controlsVisible));
  }, []);

  const toggleGalleryControls = useCallback(() => {
    const shouldShow = !galleryControlsVisible;
    setControlsVisiblePreference(shouldShow);
    applyGalleryControlsVisibility(shouldShow);
  }, [applyGalleryControlsVisibility, galleryControlsVisible]);

  const openSemanticSearch = useCallback(() => {
    setControlsVisiblePreference(true);
    applyGalleryControlsVisibility(true);
    setPendingSemanticSearchReveal(true);
  }, [applyGalleryControlsVisibility]);

  useEffect(() => {
    if (!pendingSemanticSearchReveal || !galleryControlsVisible) return;

    let secondFrameId: number | null = null;
    const frameId = window.requestAnimationFrame(() => {
      secondFrameId = window.requestAnimationFrame(() => {
        semanticSearchRef.current?.reveal();
        setPendingSemanticSearchReveal(false);
      });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      if (secondFrameId !== null) {
        window.cancelAnimationFrame(secondFrameId);
      }
    };
  }, [galleryControlsVisible, pendingSemanticSearchReveal]);

  useEffect(() => {
    if (galleryControlsVisible) return;
    setPendingSemanticSearchReveal(false);
    semanticSearchRef.current?.collapse();
  }, [galleryControlsVisible]);

  const fetchImages = useCallback(async ({
    silent = false,
    forceRefresh = false,
    syncNamespaces = false,
  }: { silent?: boolean; forceRefresh?: boolean; syncNamespaces?: boolean } = {}) => {
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
      const focusAssetId =
        focusTarget && !focusAppliedRef.current
          ? focusTarget.assetId
          : undefined;
      const url = buildGalleryImagesUrl({
        forceRefresh,
        namespace,
        videoLimitOverride,
        includeExtrasForGallery,
        showMotionAssetsOnly: showMotionAssetsOnlyRef.current,
        serverQuery: galleryServerQueryRef.current,
        focusAssetId,
      });
      const response = await fetch(url, { signal: controller.signal });
      const data = await response.json();
      if (response.ok) {
        // Deduplicate images by ID to prevent duplicate key errors in React
        const rawImages = data.images || [];
        const seen = new Set<string>();
        const uniqueImages = rawImages.filter((img: CloudflareImage) => {
          if (seen.has(img.id)) return false;
          seen.add(img.id);
          return true;
        });
        setImages(uniqueImages);
        const nextPagination = data?.pagination;
        setServerPagination(
          nextPagination &&
            typeof nextPagination.page === 'number' &&
            typeof nextPagination.pageSize === 'number' &&
            typeof nextPagination.total === 'number' &&
            typeof nextPagination.totalPages === 'number'
            ? {
                page: nextPagination.page,
                pageSize: nextPagination.pageSize,
                scopeTotal:
                  typeof nextPagination.scopeTotal === 'number'
                    ? nextPagination.scopeTotal
                    : undefined,
                total: nextPagination.total,
                totalPages: nextPagination.totalPages,
              }
            : null
        );
        setServerFacets(data?.facets && typeof data.facets === 'object' ? data.facets : null);
        setServerFamilySummaryMap(data?.familySummaryMap && typeof data.familySummaryMap === 'object' ? data.familySummaryMap : {});
        setServerDuplicateSummary(data?.duplicateSummary && typeof data.duplicateSummary === 'object' ? data.duplicateSummary : null);
        const responseFocus = data?.focus as
          | {
              assetId?: unknown;
              found?: unknown;
              index?: unknown;
              ordinal?: unknown;
              page?: unknown;
              pageSize?: unknown;
              total?: unknown;
            }
          | null
          | undefined;
        setServerFocus(
          responseFocus &&
            typeof responseFocus.assetId === 'string' &&
            typeof responseFocus.found === 'boolean' &&
            typeof responseFocus.index === 'number' &&
            typeof responseFocus.ordinal === 'number' &&
            typeof responseFocus.page === 'number' &&
            typeof responseFocus.pageSize === 'number' &&
            typeof responseFocus.total === 'number'
            ? {
                assetId: responseFocus.assetId,
                found: responseFocus.found,
                index: responseFocus.index,
                ordinal: responseFocus.ordinal,
                page: responseFocus.page,
                pageSize: responseFocus.pageSize,
                total: responseFocus.total,
              }
            : null
        );
        const responseVideoMeta = data?.videoMeta as
          | { truncated?: boolean; returned?: number; totalScoped?: number; limit?: number; enabled?: boolean }
          | undefined;
        const nextVideoMeta: VideoMetaState = responseVideoMeta
          ? {
              enabled: Boolean(responseVideoMeta.enabled),
              limit: typeof responseVideoMeta.limit === 'number' ? responseVideoMeta.limit : 0,
              returned: typeof responseVideoMeta.returned === 'number' ? responseVideoMeta.returned : 0,
              totalScoped: typeof responseVideoMeta.totalScoped === 'number' ? responseVideoMeta.totalScoped : 0,
              truncated: Boolean(responseVideoMeta.truncated),
            }
          : null;
        setVideoMeta(nextVideoMeta);
        if (nextVideoMeta?.enabled && nextVideoMeta.truncated) {
          const returned = nextVideoMeta.returned;
          const totalScoped = nextVideoMeta.totalScoped || returned;
          const limit = nextVideoMeta.limit || returned;
          setVideoResultsNotice(
            `Showing ${returned} of ${totalScoped} videos (limit ${limit}). Page near the end to auto-load more, or use “Load more videos”.`
          );
        } else {
          setVideoResultsNotice(null);
        }
        rememberGalleryWarmCache(namespace ?? '', uniqueImages);
        if (PERF_LOGGING_ENABLED) {
          const elapsedMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt;
          const serverTiming = response.headers.get('server-timing') ?? 'n/a';
          const stageTiming = data?.timings ? JSON.stringify(data.timings) : '{}';
          console.info(
            `[GalleryPerf] /api/images ${Math.round(elapsedMs)}ms (silent=${silent}, refresh=${forceRefresh}, count=${uniqueImages.length}, total=${data?.pagination?.total ?? uniqueImages.length}) server_timing=${serverTiming} stages=${stageTiming}`
          );
        }
        if (syncNamespaces || forceRefresh) {
          void fetchNamespaces('no-store');
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
  }, [namespace, PERF_LOGGING_ENABLED, videoLimitOverride, includeExtrasForGallery, fetchNamespaces]);

  useEffect(() => {
    if (loading || initialLoadLoggedRef.current) return;
    initialLoadLoggedRef.current = true;
    if (!PERF_LOGGING_ENABLED) return;
    const elapsedMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - initialLoadStartedAtRef.current;
    console.info(
      `[GalleryPerf] initial_render ${Math.round(elapsedMs)}ms (images=${images.length}, total=${serverPagination?.total ?? images.length}, returningFromDetail=${returningFromDetailRef.current})`
    );
  }, [images.length, loading, PERF_LOGGING_ENABLED, serverPagination]);

  const handleFoldersChanged = async () => {
    await fetchImages({ silent: true });
  };

  // Expose the refresh function via ref
  useImperativeHandle(ref, () => ({
    refreshImages: () => fetchImages({ silent: true, syncNamespaces: true }) // Silent refresh for better UX
  }));

  // Refresh when refreshTrigger changes
  useEffect(() => {
    if (refreshTrigger && refreshTrigger > 0) {
      fetchImages({ silent: true, syncNamespaces: true }); // Silent refresh
    }
  }, [refreshTrigger, fetchImages]);

  const prevNamespaceRef = useRef(namespace);
  const pendingReturnNamespaceRef = useRef(
    Boolean(
      initialGalleryReturnStateRef.current &&
      initialGalleryReturnStateRef.current.namespace !== (namespace ?? '')
    )
  );

  useEffect(() => {
    // Reset filters when namespace changes to avoid "empty" views due to stale filters
    if (prevNamespaceRef.current !== namespace) {
      const restoreNamespace = initialGalleryReturnStateRef.current?.namespace ?? '';
      const shouldPreserveRestoredFilters =
        pendingReturnNamespaceRef.current && restoreNamespace === (namespace ?? '');

      if (!shouldPreserveRestoredFilters) {
        setSelectedFolder('all');
        setSelectedTag('');
        setSearchTerm('');
        setOnlyCanonical(false); // Disable "Parents Only" as it might hide orphaned variants in the new namespace
        setShowMotionAssetsOnly(false);
        setAspectRatioFilters([]);
      } else {
        pendingReturnNamespaceRef.current = false;
      }
      setPromptThisMap({});
      setVideoLimitOverride(null);
      setVideoMeta(null);
      setServerFocus(null);
      setVideoResultsNotice(null);
      videoAutoExpandPageRef.current = null;
      requestedPromptIdsRef.current.clear();
      prevNamespaceRef.current = namespace;
    }

    // Cancel any pending request for the previous namespace
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    if (deferInitialFetchRef.current) {
      deferInitialFetchRef.current = false;
      if (PERF_LOGGING_ENABLED) {
        console.info('[GalleryPerf] skipped_return_fetch using restored snapshot');
      }
      return;
    }
    const shouldSilentFetch = initialSilentFetchRef.current;
    initialSilentFetchRef.current = false;
    fetchImages({ silent: shouldSilentFetch });
  }, [namespace, fetchImages]);

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
  }, [images, toast.push]);

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

  const VARIANT_PRESETS = ['small', 'medium', 'large', 'xlarge', 'full', 'thumbnail'];

  const getVariantUrls = (image: CloudflareImage) => {
    return getMultipleImageUrls(image.id, VARIANT_PRESETS);
  };
  const getVariantWidthLabel = (variant: string) => {
    const width = VARIANT_DIMENSIONS.get(variant);
    if (!width) {
      return null;
    }
    return `${width}px`;
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
    showMotionAssetsOnly,
    setShowMotionAssetsOnly,
    showFavoritesOnly,
    setShowFavoritesOnly,
    showComfyOnly,
    setShowComfyOnly,
    showDuplicatesOnly,
    setShowDuplicatesOnly,
    showBrokenOnly,
    setShowBrokenOnly,
    embeddingFilter,
    setEmbeddingFilter,
    aspectRatioFilters,
    setAspectRatioFilters,
    dateFilter,
    setDateFilter,
    hiddenFolders,
    hiddenTags,
    hideFolderByName,
    unhideFolderByName,
    clearHiddenFolders,
    hideTagByName,
    unhideTagByName,
    clearHiddenTags,
    filteredImages,
    filteredWithVariants,
    sortedImages,
    duplicateGroups,
    duplicateIds,
    childrenMap,
    familySummaryMap,
    hasActiveFilters,
    clearFilters,
    currentPage,
    pageSize,
    setPageSize,
    totalPages,
    pageImages,
    showPagination,
    hasResults,
    pageIndex,
    currentPageRangeLabel,
    prevPageRangeLabel,
    nextPageRangeLabel,
    setCurrentPage,
    goToPageNumber,
    goToPreviousPage,
    goToNextPage,
    goToFirstPage,
    goToLastPage,
    jumpBackTenPages,
    jumpForwardTenPages,
    scrollGalleryToTop,
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
      pageSize: storedPreferencesRef.current.pageSize ?? DEFAULT_PAGE_SIZE,
      currentPage: storedPreferencesRef.current.currentPage ?? 1,
    },
    brokenImageIds,
    isLoading: loading,
    returningFromDetailRef,
  });

  const {
    focusedGalleryAssetId,
    focusNotice,
    setFocusNotice,
    focusAppliedRef,
    focusReconcileSkipRef,
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
  });

  const hiddenFolderSet = useMemo(() => new Set(hiddenFolders), [hiddenFolders]);
  const hiddenTagSet = useMemo(() => new Set(hiddenTags.map(tag => tag.toLowerCase())), [hiddenTags]);
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
      showMotionAssetsOnly,
    }),
    [
      aspectRatioFilters,
      currentPage,
      dateFilter,
      embeddingFilter,
      hiddenFolders,
      hiddenTags,
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
    void fetchImages({ silent: true });
  }, [fetchImages, serverGalleryQueryKey, serverGalleryQuery]);

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

  const saveGalleryReturnState = useCallback((imageId: string) => {
    if (typeof window === 'undefined') return;
    try {
      const resultIds = pageImages.map((img) => img.id);
      const savedAt = Date.now();
      const selectedAsset = filteredImages.find((img) => img.id === imageId) ?? pageImages.find((img) => img.id === imageId);
      if (selectedAsset) {
        saveDetailAssetSeed(selectedAsset, namespace ?? '', savedAt);
      }
      persistGalleryReturnState({
        scrollY: window.scrollY,
        namespace: namespace ?? '',
        savedAt,
        selectedImageId: imageId,
        resultIds,
        resultAssets: pageImages.map((img) => ({
          id: img.id,
          assetType: img.assetType === 'video' ? 'video' : 'image',
        })),
        filters: {
          searchTerm,
          colorSearchHex,
          selectedFolder,
          selectedTag,
          onlyCanonical,
          onlyWithVariants,
          showMotionAssetsOnly,
          showFavoritesOnly,
          showDuplicatesOnly,
          showBrokenOnly,
          showComfyOnly,
          embeddingFilter,
          aspectRatioFilters,
          dateFilter,
          hiddenFolders,
          hiddenTags,
          pageSize,
          currentPage,
        },
      });
      window.sessionStorage.setItem(
        GALLERY_RETURN_SNAPSHOT_KEY,
        JSON.stringify({
          currentPage,
          namespace: namespace ?? '',
          savedAt,
          images: pageImages,
        })
      );
    } catch {
      // ignore
    }
  }, [
    aspectRatioFilters,
    currentPage,
    dateFilter,
    embeddingFilter,
    filteredImages,
    hiddenFolders,
    hiddenTags,
    namespace,
    onlyCanonical,
    onlyWithVariants,
    pageImages,
    pageSize,
    colorSearchHex,
    searchTerm,
    selectedFolder,
    selectedTag,
    showMotionAssetsOnly,
    showFavoritesOnly,
    showBrokenOnly,
    showComfyOnly,
    showDuplicatesOnly,
  ]);

  const galleryReturnHrefSuffix = useMemo(() => {
    const params = new URLSearchParams();
    params.set('gpage', String(currentPage));
    params.set('gns', namespace ?? '');
    if (colorSearchHex) {
      params.set('gcolor', colorSearchHex);
    }
    return `?${params.toString()}`;
  }, [colorSearchHex, currentPage, namespace]);

  const loadMoreVideos = useCallback(() => {
    setVideoLimitOverride((prev) => {
      const base = typeof prev === 'number' && prev > 0
        ? prev
        : (videoMeta?.limit && videoMeta.limit > 0 ? videoMeta.limit : VIDEO_LIMIT_STEP);
      return base + VIDEO_LIMIT_STEP;
    });
  }, [videoMeta]);

  useEffect(() => {
    if (!videoMeta?.enabled || !videoMeta.truncated) return;
    if (loading) return;
    if (currentPage <= 1) return;
    if (currentPage < totalPages) return;
    if (videoAutoExpandPageRef.current === currentPage) return;
    videoAutoExpandPageRef.current = currentPage;
    loadMoreVideos();
  }, [videoMeta, loading, currentPage, totalPages, loadMoreVideos]);

  useEffect(() => {
    if (!videoMeta?.truncated) {
      videoAutoExpandPageRef.current = null;
    }
  }, [videoMeta]);

  useEffect(() => {
    if (!colorSearchHex) {
      setColorSearchRows([]);
      setColorSearchError(null);
      setColorSearchLoading(false);
      return;
    }

    const controller = new AbortController();
    const searchNamespace = namespace === '__all__' ? null : (namespace ?? '');

    const fetchColorSearchResults = async () => {
      setColorSearchLoading(true);
      setColorSearchError(null);

      try {
        const response = await fetch('/api/images/search', {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'x-photarium-component': 'ImageGallery',
            'x-photarium-trigger': 'swatch-click',
            'x-photarium-source': 'ui',
          },
          body: JSON.stringify({
            type: 'color',
            query: colorSearchHex,
            limit: COLOR_SEARCH_LIMIT,
            namespace: searchNamespace,
            diagnostics: {
              component: 'ImageGallery',
              trigger: 'swatch-click',
            },
          }),
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data?.error || 'Color search failed');
        }

        setColorSearchRows(Array.isArray(data?.results) ? data.results : []);
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
        console.error('Failed to fetch color search results:', error);
        setColorSearchRows([]);
        setColorSearchError(error instanceof Error ? error.message : 'Color search failed');
      } finally {
        if (!controller.signal.aborted) {
          setColorSearchLoading(false);
        }
      }
    };

    void fetchColorSearchResults();

    return () => controller.abort();
  }, [colorSearchHex, namespace]);

  // Enrich only the visible page with Redis metadata after initial render.
  useEffect(() => {
    if (pageImages.length === 0) return;

    const fetchVisiblePageMetadata = async () => {
      try {
        const idsToFetch = pageImages
          .map((img) => img.id)
          .filter((id) => {
            const lastRequestedAt = requestedColorIdsRef.current.get(id);
            return !lastRequestedAt || Date.now() - lastRequestedAt > COLOR_METADATA_RETRY_MS;
          });

        if (idsToFetch.length === 0) return;

        for (const id of idsToFetch) {
          requestedColorIdsRef.current.set(id, Date.now());
        }

        const chunkSize = 60;
        for (let i = 0; i < idsToFetch.length; i += chunkSize) {
          const chunk = idsToFetch.slice(i, i + chunkSize);
          const response = await fetch(`/api/images/colors?ids=${encodeURIComponent(chunk.join(','))}`);
          if (!response.ok) continue;
          const data = await response.json();
          const colors = data?.colors;
          if (!colors || typeof colors !== 'object') continue;

          setImages((prev) =>
            prev.map((img) => {
              const meta = colors[img.id] as
                | {
                    dominantColors?: string[];
                    averageColor?: string;
                    hasClipEmbedding?: boolean;
                    hasColorEmbedding?: boolean;
                  }
                | undefined;
              if (!meta) return img;
              const hasRedisMetadata =
                Array.isArray(meta.dominantColors) ||
                typeof meta.averageColor === 'string' ||
                Boolean(meta.hasClipEmbedding) ||
                Boolean(meta.hasColorEmbedding);
              if (!hasRedisMetadata) {
                return img;
              }
              return {
                ...img,
                hasClipEmbedding: img.hasClipEmbedding || Boolean(meta.hasClipEmbedding),
                hasColorEmbedding: img.hasColorEmbedding || Boolean(meta.hasColorEmbedding),
                dominantColors: meta.dominantColors ?? img.dominantColors,
                averageColor: meta.averageColor ?? img.averageColor,
              };
            })
          );

          if (ENABLE_COLOR_METADATA) {
            setColorMetadataMap((prev) => ({ ...prev, ...colors }));
          }
        }
      } catch (error) {
        console.warn('Failed to fetch visible page metadata:', error);
      }
    };

    void fetchVisiblePageMetadata();
  }, [COLOR_METADATA_RETRY_MS, ENABLE_COLOR_METADATA, pageImages]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem('galleryPreferences', JSON.stringify({
        onlyCanonical,
        respectAspectRatio,
        variant: selectedVariant,
        onlyWithVariants,
        showMotionAssetsOnly,
        showFavoritesOnly,
        showComfyOnly,
        selectedFolder,
        selectedTag,
        searchTerm,
        viewMode,
        gridSize,
        filtersCollapsed,
        bulkFolderInput,
        bulkFolderMode,
        showDuplicatesOnly,
        showBrokenOnly,
        aspectRatioFilters,
        showCli,
        controlsVisible: controlsVisiblePreference,
        pageSize,
        dateFilter,
        currentPage
      }));
    } catch (error) {
      console.warn('Failed to save gallery prefs', error);
    }
  }, [
    onlyCanonical,
    respectAspectRatio,
    selectedVariant,
    onlyWithVariants,
    showMotionAssetsOnly,
    showFavoritesOnly,
    showComfyOnly,
    selectedFolder,
    selectedTag,
    searchTerm,
    viewMode,
    gridSize,
    filtersCollapsed,
    bulkFolderInput,
    bulkFolderMode,
    showDuplicatesOnly,
    showBrokenOnly,
    aspectRatioFilters,
    showCli,
    controlsVisiblePreference,
    pageSize,
    dateFilter,
    currentPage,
  ]);

  // Fetch Prompt This text only when a search term is active.
  // Prompt This records live outside Cloudflare metadata, so we batch-load them on demand.
  // NOTE: We use promptThisMapRef to check already-fetched IDs without triggering effect re-runs.
  useEffect(() => {
    if (!searchTerm.trim()) return;
    if (images.length === 0) return;

    let cancelled = false;

    const fetchPrompts = async () => {
      try {
        const idsToFetch = images
          .map((img) => img.id)
          .filter((id) => {
            // Use ref to avoid stale closure and prevent effect re-runs
            if (Object.prototype.hasOwnProperty.call(promptThisMapRef.current, id)) return false;
            const lastRequestedAt = requestedPromptIdsRef.current.get(id);
            return !lastRequestedAt || Date.now() - lastRequestedAt > PROMPT_THIS_RETRY_MS;
          });

        if (idsToFetch.length === 0) return;
        idsToFetch.forEach((id) => requestedPromptIdsRef.current.set(id, Date.now()));

        const chunkSize = 50;
        for (let i = 0; i < idsToFetch.length; i += chunkSize) {
          if (cancelled) return;
          const chunk = idsToFetch.slice(i, i + chunkSize);
          const response = await fetch(`/api/images/prompts?ids=${encodeURIComponent(chunk.join(','))}`);
          if (!response.ok) continue;
          const data = await response.json();
          if (cancelled) return;
          if (data?.prompts && typeof data.prompts === 'object') {
            setPromptThisMap((prev) => ({ ...prev, ...data.prompts }));
          }
        }
      } catch (error) {
        console.warn('Failed to fetch Prompt This text:', error);
      }
    };

    void fetchPrompts();

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images, searchTerm]);

  const {
    selectedImageIds,
    selectedCount,
    toggleSelection,
    clearSelection,
    selectAllOnPage,
    selectDuplicateImages: selectDuplicateImagesBase,
    selectDuplicatesKeepSingle: selectDuplicatesKeepSingleBase,
  } = useGallerySelection({
    images,
    duplicateGroups,
    duplicateIds,
    serverDuplicateIds: serverDuplicateSummary?.allDuplicateIds,
    serverDuplicateIdsExcludingNewest: serverDuplicateSummary?.duplicateIdsExcludingNewest,
    serverDuplicateIdsExcludingOldest: serverDuplicateSummary?.duplicateIdsExcludingOldest,
    bulkSelectionMode,
    setBulkSelectionMode,
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
    images,
    setImages,
    toastPush: toast.push,
    setAltLoadingMap,
    setDisplayNameLoadingMap,
    editFolderSelect,
    newEditFolder,
    editTags,
    setEditingImage,
    setEditFolderSelect,
    setNewEditFolder,
    setEditTags,
  });

  const toggleFavorite = useCallback(async (imageId: string) => {
    const target = images.find(img => img.id === imageId);
    if (!target || target.assetType === 'video') {
      return;
    }

    const nextFavorite = !hasFavoriteTag(target.tags);
    setFavoriteLoadingMap(prev => ({ ...prev, [imageId]: true }));
    try {
      const { ok, payload } = await patchImageFavorite(imageId, nextFavorite);
      if (!ok || !Array.isArray(payload.tags)) {
        toast.push(payload.error || 'Failed to update favorite');
        return;
      }
      setImages(prev => prev.map(img => (img.id === imageId ? { ...img, tags: payload.tags } : img)));
      toast.push(nextFavorite ? 'Added to favorites' : 'Removed from favorites');
    } catch (error) {
      console.error('Failed to update favorite:', error);
      toast.push('Failed to update favorite');
    } finally {
      setFavoriteLoadingMap(prev => {
        const next = { ...prev };
        delete next[imageId];
        return next;
      });
    }
  }, [images, setImages, toast]);

  const {
    applyBulkUpdates,
    createBulkAnimation,
    deleteSelectedImages,
    generateEmbeddingsForSelected,
  } = useGalleryBulkActions({
    images,
    setImages,
    toastPush: toast.push,
    selectedCount,
    selectedImageIds,
    clearSelection,
    setBulkSelectionMode,
    setBulkEditOpen,
    setBulkAnimateFilename,
    setBulkAnimateFps,
    setBulkAnimateLoop,
    setBulkAnimateOrderMode,
    setBulkAnimateTouched,
    bulkApplyFolder,
    bulkApplyTags,
    bulkFolderInput,
    bulkTagsInput,
    bulkTagsAiCount,
    bulkTagsMode,
    bulkApplyDisplayName,
    bulkDisplayNameInput,
    bulkDisplayNameMode,
    bulkApplyDescription,
    bulkDescriptionAppendInput,
    bulkApplyNamespace,
    bulkNamespaceInput,
    bulkFolderMode,
    setBulkUpdating,
    setBulkDeleting,
    setBulkEmbeddingGenerating,
    setBulkAnimateLoading,
    setBulkAnimateError,
    bulkAnimateFps,
    bulkAnimateFilename,
    bulkAnimateLoop,
    bulkAnimateOrderMode,
    namespace,
    fetchImages,
  });

  useEffect(() => {
    if (bulkAnimateTouched) return;
    if (selectedCount === 0) {
      setBulkAnimateFps('');
      return;
    }
    const next = Math.max(1, selectedCount / 2);
    setBulkAnimateFps(next.toString());
  }, [bulkAnimateTouched, selectedCount]);

  const openBulkEditModal = useCallback(() => {
    if (!selectedCount) {
      toast.push('Select at least one asset');
      return;
    }
    dispatchBulk({ type: 'resetEdit' });
  }, [selectedCount, toast]);

  const closeBulkEditModal = useCallback(() => {
    setBulkEditOpen(false);
  }, [setBulkEditOpen]);

  const duplicateGroupCount = serverDuplicateSummary?.groupCount ?? duplicateGroups.length;
  const duplicateImageCount = serverDuplicateSummary?.imageCount ?? duplicateIds.size;

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

  const variantOptions = useMemo(
    () => [
      { value: 'full', label: 'Full (No Resize)' },
      { value: 'w=300', label: 'Small (300px)' },
      { value: 'w=600', label: 'Medium (600px)' },
      { value: 'w=900', label: 'Large (900px)' },
      { value: 'w=1200', label: 'X-Large (1200px)' },
      { value: 'w=150', label: 'Thumbnail-ish (150px)' }
    ],
    []
  );

  const editFolderOptions = useMemo(
    () => [
      { value: '', label: '[none]' },
      ...uniqueFolders.map(folder => ({ value: folder as string, label: folder as string })),
      { value: '__create__', label: 'Create new folder...' }
    ],
    [uniqueFolders]
  );
  const bulkFolderOptions = useMemo(
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

  const handleBulkFolderSelect = useCallback(
    (value: string) => {
      if (value === '__create__') {
        setBulkFolderMode('new');
        setBulkFolderInput('');
      } else {
        setBulkFolderMode('existing');
        setBulkFolderInput(value);
      }
    },
    [setBulkFolderInput, setBulkFolderMode]
  );

  const selectedImagesForPayload = useMemo(
    () =>
      images
        .filter((image) => selectedImageIds.has(image.id))
        .map((image) => ({
          id: image.id,
          filename: image.filename || image.displayName || image.id,
          altText: image.altText,
          altTag: image.altTag,
        })),
    [images, selectedImageIds]
  );
  const selectedGalleryOrderIds = useMemo(
    () => selectedImagesForPayload.map((image) => image.id),
    [selectedImagesForPayload]
  );
  const selectedInsertionOrderIds = useMemo(
    () => Array.from(selectedImageIds),
    [selectedImageIds]
  );
  const selectedAnimationPreview = useMemo(
    () => (
      bulkAnimateOrderMode === 'reverse-gallery'
        ? [...selectedImagesForPayload].reverse()
        : selectedImagesForPayload
    ),
    [bulkAnimateOrderMode, selectedImagesForPayload]
  );
  const bulkAnimateSelectionOrderDiffers = useMemo(
    () =>
      selectedGalleryOrderIds.length > 1 &&
      selectedInsertionOrderIds.length === selectedGalleryOrderIds.length &&
      selectedInsertionOrderIds.some((id, index) => id !== selectedGalleryOrderIds[index]),
    [selectedGalleryOrderIds, selectedInsertionOrderIds]
  );

  const handleCopySelectionPayload = useCallback(
    async (payload: string) => {
      try {
        await navigator.clipboard.writeText(payload);
        toast.push('Selection JSON copied');
      } catch (error) {
        console.error('Failed to copy selection JSON payload', error);
        toast.push('Failed to copy selection JSON');
      }
    },
    [toast]
  );

  useEffect(() => {
    scrollGalleryToTop();
  }, [scrollGalleryToTop]);

  const viewFilters = useMemo(() => ({
    images: pageImages,
    selectedVariant,
    respectAspectRatio,
    bulkSelectionMode,
    selectedImageIds,
    duplicateIds,
    childrenMap,
    familySummaryMap,
    colorMetadataMap,
    embeddingPendingMap,
    altLoadingMap,
    displayNameLoadingMap,
    favoriteLoadingMap,
    galleryReturnHrefSuffix,
    activeColorSearchHex: colorSearchHex,
    focusedGalleryAssetId,
  }), [
    pageImages,
    selectedVariant,
    respectAspectRatio,
    bulkSelectionMode,
    selectedImageIds,
    duplicateIds,
    childrenMap,
    familySummaryMap,
    colorMetadataMap,
    embeddingPendingMap,
    altLoadingMap,
    displayNameLoadingMap,
    favoriteLoadingMap,
    galleryReturnHrefSuffix,
    colorSearchHex,
    focusedGalleryAssetId,
  ]);
  const handleSelectColor = useCallback((hex: string) => {
    const normalized = normalizeColorSearchHex(hex);
    if (!normalized) return;
    setColorSearchHex(normalized);
    setColorSearchRows([]);
    setColorSearchError(null);
    goToFirstPage();
    scrollGalleryToTop();
  }, [goToFirstPage, scrollGalleryToTop]);
  const handleClearFilters = useCallback(() => {
    clearFilters();
    clearColorSearch();
  }, [clearColorSearch, clearFilters]);

  const serverPagedResultCount = colorSearchHex ? null : serverPagination?.total ?? null;
  const galleryResultCount = serverPagedResultCount ?? filteredWithVariants.length;
  const galleryTotalCount =
    !colorSearchHex && serverPagination?.scopeTotal !== undefined
      ? serverPagination.scopeTotal
      : serverPagedResultCount ?? images.length;

  if (loading) {
    return (
      <div id="image-gallery-loading" className="bg-white rounded-lg shadow-lg p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-300 rounded w-1/4 mb-4"></div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="aspect-square bg-gray-300 rounded-lg"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div id="image-gallery-card" ref={galleryTopRef} className="overscroll-none bg-white rounded-lg shadow-lg p-6">
      <div
        id="gallery-top-bar"
        className="sticky top-0 z-[3000] -m-6 mb-6 overflow-visible rounded-t-lg border-b border-gray-100 bg-white/95 backdrop-blur"
      >
        <GalleryCompactHeader
          filteredCount={galleryResultCount}
          totalCount={galleryTotalCount}
          pageIndex={pageIndex}
          totalPages={totalPages}
          namespaceLabel={namespaceLabel}
          controlsVisible={galleryControlsVisible}
          showSearchButton={semanticSearchAvailable}
          onToggleControls={toggleGalleryControls}
          onOpenSearch={openSemanticSearch}
        />
        <GalleryPagerStrip
          pageIndex={pageIndex}
          totalPages={totalPages}
          prevPageRangeLabel={prevPageRangeLabel}
          nextPageRangeLabel={nextPageRangeLabel}
          onFirstPage={goToFirstPage}
          onJumpBackTen={jumpBackTenPages}
          onPrevPage={goToPreviousPage}
          onNextPage={goToNextPage}
          onJumpForwardTen={jumpForwardTenPages}
          onLastPage={goToLastPage}
        />
      </div>

      <GalleryNoticeStack
        duplicateGroupCount={duplicateGroupCount}
        duplicateImageCount={duplicateImageCount}
        showDuplicatesOnly={showDuplicatesOnly}
        colorSearchHex={colorSearchHex}
        colorSearchLoading={colorSearchLoading}
        colorSearchError={colorSearchError}
        galleryResultCount={galleryResultCount}
        focusNotice={focusNotice}
        onToggleDuplicatesOnly={() => setShowDuplicatesOnly(!showDuplicatesOnly)}
        onSelectDuplicateImages={selectDuplicateImages}
        onSelectDuplicatesKeepSingle={selectDuplicatesKeepSingle}
        onClearColorSearch={clearColorSearch}
        onDismissFocusNotice={() => setFocusNotice(null)}
      />

      <GalleryControlsPanel
        visible={galleryControlsVisible}
        filtersCollapsed={filtersCollapsed}
        semanticSearchRef={semanticSearchRef}
        namespace={namespace}
        onSemanticAvailabilityChange={setSemanticSearchAvailable}
        legacyTopBarProps={{
          filteredCount: galleryResultCount,
          totalCount: galleryTotalCount,
          namespaceLabel,
          namespace,
          showPagination,
          currentPageRangeLabel,
          sortedImages,
          dateFilter,
          onDateFilterChange: setDateFilter,
          bulkSelectionMode,
          filtersCollapsed,
          hasActiveFilters,
          pageSize,
          pageSizeOptions: PAGE_SIZE_OPTIONS,
          defaultPageSize: DEFAULT_PAGE_SIZE,
          gridSize,
          refreshingCache,
          viewMode,
          selectedCount,
          bulkEmbeddingGenerating,
          bulkDeleting,
          onToggleBulkSelection: () => setBulkSelectionMode(!bulkSelectionMode),
          onToggleFilters: () => setFiltersCollapsed((prev) => !prev),
          onClearFilters: handleClearFilters,
          onPageSizeChange: handlePageSizeChange,
          onGridSizeChange: setGridSize,
          onRefreshCache: () => fetchImages({ forceRefresh: true }),
          onOpenNamespaceSettings: () => setNamespaceSettingsOpen(true),
          onToggleViewMode: () => setViewMode(viewMode === 'grid' ? 'list' : 'grid'),
          onSelectPage: () => selectAllOnPage(pageImages),
          onClearSelection: clearSelection,
          onOpenBulkEdit: openBulkEditModal,
          onGenerateEmbeddings: generateEmbeddingsForSelected,
          onDeleteSelected: deleteSelectedImages,
        }}
        backupTimeLabel={backupTimeLabel}
        backupSizeLabel={backupSizeLabel}
        backupAgeLabel={backupAgeLabel}
        backupError={backupError}
        backupLoading={backupLoading}
        onCreateBackup={handleCreateBackup}
        galleryFiltersProps={{
          searchTerm,
          onSearchChange: setSearchTerm,
          folders: uniqueFolders,
          selectedFolder,
          onFolderChange: handleFolderFilterChange,
          hiddenFolders: hiddenFolderSet,
          onToggleHiddenFolder: (folder: string) =>
            hiddenFolderSet.has(folder) ? unhideFolderByName(folder) : hideFolderByName(folder),
          onShowAllFolders: clearHiddenFolders,
          allTags: uniqueTags,
          selectedTag,
          onTagChange: setSelectedTag,
          hiddenTags: hiddenTagSet,
          onToggleHiddenTag: (tag: string) =>
            hiddenTagSet.has(tag.toLowerCase()) ? unhideTagByName(tag) : hideTagByName(tag),
          onShowAllTags: clearHiddenTags,
          aspectRatioFilters,
          onAspectRatioFiltersChange: setAspectRatioFilters,
          onlyCanonical,
          onOnlyCanonicalChange: setOnlyCanonical,
          respectAspectRatio,
          onRespectAspectRatioChange: setRespectAspectRatio,
          showDuplicatesOnly,
          onShowDuplicatesOnlyChange: setShowDuplicatesOnly,
          showVariationsOnly: onlyWithVariants,
          onShowVariationsOnlyChange: setOnlyWithVariants,
          showMotionAssetsOnly,
          onShowMotionAssetsOnlyChange: setShowMotionAssetsOnly,
          showFavoritesOnly,
          onShowFavoritesOnlyChange: setShowFavoritesOnly,
          showComfyOnly,
          onShowComfyOnlyChange: setShowComfyOnly,
          showOnlyMissingEmbeddings: embeddingFilter !== 'none',
          onShowOnlyMissingEmbeddingsChange: (value: boolean) =>
            setEmbeddingFilter(value ? 'missing-any' : 'none'),
          showBrokenOnly,
          onShowBrokenOnlyChange: setShowBrokenOnly,
          onClearFilters: handleClearFilters,
          hasActiveFilters: hasActiveFilters || Boolean(colorSearchHex),
        }}
        auditLoading={auditLoading}
        auditEntries={auditEntries}
        auditProgress={auditProgress}
        showCli={showCli}
        commandBarProps={{
          hiddenFolders,
          hiddenTags,
          knownFolders: uniqueFolders,
          knownTags: uniqueTags,
          onHideFolder: hideFolderByName,
          onUnhideFolder: unhideFolderByName,
          onClearHidden: clearHiddenFolders,
          onHideTag: hideTagByName,
          onUnhideTag: unhideTagByName,
          onClearHiddenTags: clearHiddenTags,
          onSelectFolder: setSelectedFolder,
          selectedTag,
          onSelectTag: setSelectedTag,
          onClearTagFilter: () => setSelectedTag(''),
          showParentsOnly: onlyWithVariants,
          onSetParentsOnly: setOnlyWithVariants,
          showComfyOnly,
          onSetComfyOnly: setShowComfyOnly,
          currentPage: pageIndex,
          totalPages,
          onGoToPage: goToPageNumber,
          embeddingFilter,
          onSetEmbeddingFilter: setEmbeddingFilter,
          onShowLastUploaded: showLastUploaded,
          onClose: () => setShowCli(false),
        }}
      />

      <GalleryUtilityRail
        expanded={utilityExpanded}
        filtersCollapsed={filtersCollapsed}
        showCli={showCli}
        videoResultsNotice={videoResultsNotice}
        videoMeta={videoMeta}
        selectedCount={selectedCount}
        onExpandChange={setUtilityExpanded}
        onToggleFilters={() => setFiltersCollapsed((prev) => !prev)}
        onToggleCli={() => setShowCli((prev) => !prev)}
        onLoadMoreVideos={loadMoreVideos}
        onSelectPage={() => selectAllOnPage(pageImages)}
        onOpenBulkEdit={openBulkEditModal}
        onClearSelection={clearSelection}
        onScrollTop={scrollGalleryToTop}
        onScrollToUploader={scrollToUploader}
      />

      <GalleryResultsRegion
        hasResults={hasResults}
        galleryTotalCount={galleryTotalCount}
        colorSearchHex={colorSearchHex}
        hasActiveFilters={hasActiveFilters}
        viewMode={viewMode}
        gridSize={gridSize}
        viewFilters={viewFilters}
        selectedVariant={selectedVariant}
        variantOptions={variantOptions}
        namespace={namespace}
        auditLoading={auditLoading}
        auditProgress={auditProgress}
        brokenAudit={brokenAudit}
        onClearFilters={handleClearFilters}
        onToggleSelection={toggleSelection}
        onBeforeNavigate={saveGalleryReturnState}
        onCopyNamespace={(ns) => { void copyToClipboard(ns, 'Namespace', toast.push); }}
        onSelectColor={handleSelectColor}
        onToggleCopyMenu={handleOpenCopyMenu}
        onStartEdit={startEdit}
        onDelete={deleteImage}
        onToggleFavorite={toggleFavorite}
        onGenerateAlt={generateAltTag}
        onGenerateDisplayName={generateDisplayName}
        onDragStart={(event, img) => setDragPayloadForImage(event, img)}
        onMouseEnter={handleMouseEnter}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onVariantChange={setSelectedVariant}
        onFoldersChanged={handleFoldersChanged}
        onRunBrokenAudit={runBrokenAudit}
      />

      <GalleryModals
        images={images}
        openCopyMenu={openCopyMenu}
        onCloseCopyMenu={() => setOpenCopyMenu(null)}
        getVariantUrls={getVariantUrls}
        getVariantWidthLabel={getVariantWidthLabel}
        onCopyUrl={handleCopyUrl}
        onDownload={downloadVariantToFile}
        namespaceModalOpen={namespaceSettingsOpen}
        namespaceSelectValue={namespaceSelectValue}
        namespaceDraft={namespaceDraft}
        namespaceOptions={namespaceOptions}
        onNamespaceSelectChange={handleNamespaceSelectChange}
        onNamespaceDraftChange={handleNamespaceDraftChange}
        onNamespaceCancel={() => setNamespaceSettingsOpen(false)}
        onNamespaceSave={handleNamespaceSave}
        selectedNamespaceForDelete={selectedNamespaceForDelete}
        canDeleteSelectedNamespace={canDeleteSelectedNamespace}
        deletingNamespace={namespaceDeleting}
        onDeleteNamespace={handleNamespaceDelete}
        editingImage={editingImage}
        editFolderSelect={editFolderSelect}
        editFolderOptions={editFolderOptions}
        newEditFolder={newEditFolder}
        editTags={editTags}
        onEditFolderSelect={setEditFolderSelect}
        onNewEditFolderChange={setNewEditFolder}
        onEditTagsChange={setEditTags}
        onEditCancel={cancelEdit}
        onEditSave={() => {
          if (editingImage) {
            void saveEdit(editingImage);
          }
        }}
        bulkEditOpen={bulkEditOpen}
        selectedCount={selectedCount}
        selectedImagesForPayload={selectedImagesForPayload}
        selectedAnimationPreview={selectedAnimationPreview}
        bulkAnimateOrderMode={bulkAnimateOrderMode}
        onBulkAnimateOrderModeChange={setBulkAnimateOrderMode}
        bulkAnimateSelectionOrderDiffers={bulkAnimateSelectionOrderDiffers}
        onCopySelectionPayload={handleCopySelectionPayload}
        bulkApplyFolder={bulkApplyFolder}
        onBulkApplyFolderChange={setBulkApplyFolder}
        bulkFolderMode={bulkFolderMode}
        bulkFolderInput={bulkFolderInput}
        onBulkFolderInputChange={setBulkFolderInput}
        bulkFolderOptions={bulkFolderOptions}
        onBulkFolderSelect={handleBulkFolderSelect}
        bulkApplyTags={bulkApplyTags}
        onBulkApplyTagsChange={setBulkApplyTags}
        bulkTagsMode={bulkTagsMode}
        onBulkTagsModeChange={setBulkTagsMode}
        bulkTagsInput={bulkTagsInput}
        onBulkTagsInputChange={setBulkTagsInput}
        bulkTagsAiCount={bulkTagsAiCount}
        onBulkTagsAiCountChange={setBulkTagsAiCount}
        bulkApplyDisplayName={bulkApplyDisplayName}
        onBulkApplyDisplayNameChange={setBulkApplyDisplayName}
        bulkDisplayNameMode={bulkDisplayNameMode}
        onBulkDisplayNameModeChange={setBulkDisplayNameMode}
        bulkDisplayNameInput={bulkDisplayNameInput}
        onBulkDisplayNameInputChange={setBulkDisplayNameInput}
        bulkApplyDescription={bulkApplyDescription}
        onBulkApplyDescriptionChange={setBulkApplyDescription}
        bulkDescriptionAppendInput={bulkDescriptionAppendInput}
        onBulkDescriptionAppendInputChange={setBulkDescriptionAppendInput}
        bulkApplyNamespace={bulkApplyNamespace}
        onBulkApplyNamespaceChange={setBulkApplyNamespace}
        bulkNamespaceInput={bulkNamespaceInput}
        onBulkNamespaceInputChange={setBulkNamespaceInput}
        registryNamespaces={registryNamespaces}
        onRegisterNamespace={registerNamespace}
        bulkAnimateFps={bulkAnimateFps}
        onBulkAnimateFpsChange={setBulkAnimateFps}
        bulkAnimateTouched={bulkAnimateTouched}
        onBulkAnimateTouchedChange={setBulkAnimateTouched}
        bulkAnimateLoop={bulkAnimateLoop}
        onBulkAnimateLoopChange={setBulkAnimateLoop}
        bulkAnimateFilename={bulkAnimateFilename}
        onBulkAnimateFilenameChange={setBulkAnimateFilename}
        bulkAnimateLoading={bulkAnimateLoading}
        bulkAnimateError={bulkAnimateError}
        bulkUpdating={bulkUpdating}
        onBulkApply={applyBulkUpdates}
        onBulkCreateAnimation={createBulkAnimation}
        onBulkClose={closeBulkEditModal}
      />

      {/* Hover Preview */}
      {hoveredImage && showPreview && (
        <HoverPreview
          imageId={hoveredImage}
          filename={images.find(img => img.id === hoveredImage)?.filename || 'Unknown'}
          isVisible={showPreview}
          mousePosition={mousePosition}
          onClose={handleMouseLeave}
          dimensions={images.find(img => img.id === hoveredImage)?.dimensions}
        />
      )}
    </div>
  );
});

ImageGallery.displayName = 'ImageGallery';

export default ImageGallery;
