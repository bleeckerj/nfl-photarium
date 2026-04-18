'use client';

import { useState, useEffect, forwardRef, useImperativeHandle, useMemo, useRef, useCallback, useLayoutEffect, useReducer } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import MonoSelect from './MonoSelect';
import GalleryCommandBar from './GalleryCommandBar';
import FolderManagerButton from './FolderManagerButton';
import { GalleryFilters } from './gallery/GalleryFilters';
import { type DateFilter, type EmbeddingFilter, type GridSize } from './gallery/types';
import { getMultipleImageUrls, IMAGE_VARIANTS } from '@/utils/imageUtils';
import { setDragPayloadForImage } from '@/utils/imageDrag';
import { copyToClipboard, formatCopyPayload } from '@/utils/clipboard';
import { useToast } from './Toast';
import { useImageAspectRatio } from '@/hooks/useImageAspectRatio';
import HoverPreview from './HoverPreview';
import { downloadImageToFile, formatDownloadFileName } from '@/utils/downloadUtils';
import LegacyTopBar from '@/components/gallery/LegacyTopBar';
import { GalleryCompactHeader } from '@/components/gallery/GalleryCompactHeader';
import { GalleryPagerStrip } from '@/components/gallery/GalleryPagerStrip';
import { useGallerySelection } from './gallery/hooks/useGallerySelection';
import { useGalleryFilters } from './gallery/hooks/useGalleryFilters';
import { useGalleryItemActions } from './gallery/hooks/useGalleryItemActions';
import { useGalleryBulkActions } from './gallery/hooks/useGalleryBulkActions';
import { useGalleryAudit } from './gallery/hooks/useGalleryAudit';
import { useGalleryEmbedding } from './gallery/hooks/useGalleryEmbedding';
import { GalleryListView } from './gallery/GalleryListView';
import { GalleryGridView } from './gallery/GalleryGridView';
import { GalleryModals } from './gallery/GalleryModals';
import { normalizeColorSearchHex, resolveColorSearchAssets, type ColorSearchResultRow } from './gallery/colorSearch';
import { AUDIT_LOG_LIMIT, DEFAULT_GRID_SIZE } from './gallery/constants';
import { normalizeGridSize } from './gallery/gridSizing';
import { resolveGalleryChromeScrollState, type GalleryChromeManualMode } from './gallery/galleryChrome';
import { normalizeDateFilterValue, toDateKey } from './gallery/dateFilter';
import {
  clearGalleryReturnState,
  getFreshGalleryReturnState,
  GALLERY_RETURN_SNAPSHOT_KEY,
  GALLERY_RETURN_TTL_MS,
  saveGalleryReturnState as persistGalleryReturnState,
  type NormalizedGalleryReturnState,
} from './gallery/returnState';
import { isLikelySourceSearchTerm } from '@/utils/galleryFilter';

interface CloudflareImage {
  id: string;
  assetType?: 'image' | 'video';
  filename: string;
  displayName?: string;
  promptThis?: string;
  uploaded: string;
  variants: string[];
  folder?: string;
  tags?: string[];
  description?: string;
  aspectRatio?: string;
  dimensions?: { width: number; height: number };
  altTag?: string;
  altText?: string;
  parentId?: string;
  linkedAssetId?: string;
  originalUrl?: string;
  originalUrlNormalized?: string;
  sourceUrl?: string;
  sourceUrlNormalized?: string;
  contentHash?: string;
  namespace?: string;
  generatedBy?: string;
  comfyMetadataDetected?: boolean;
  comfyMetadataSource?: string;
  videoStatus?: 'pending' | 'ready' | 'error';
  videoDurationSeconds?: number;
  videoPlaybackUrl?: string;
  videoHlsUrl?: string;
  videoThumbnailUrl?: string;
  videoPreviewUrl?: string;
  // Embedding status fields
  hasClipEmbedding?: boolean;
  hasColorEmbedding?: boolean;
  dominantColors?: string[];
  averageColor?: string;
}

interface ImageGalleryProps {
  refreshTrigger?: number;
  namespace?: string;
  onNamespaceChange?: (value: string) => void;
}

export interface ImageGalleryRef {
  refreshImages: () => void;
}

const DEFAULT_PAGE_SIZE = 30;
const PAGE_SIZE_OPTIONS = [12, 24, 30, 48, 60, 90, 120];
const VARIANT_DIMENSIONS = new Map(IMAGE_VARIANTS.map(variant => [variant.name, variant.width]));
const VIDEO_LIMIT_STEP = 150;
const COLOR_SEARCH_LIMIT = 100;

type GalleryWarmCacheState = {
  namespace: string;
  images: CloudflareImage[];
  savedAt: number;
};

type GalleryReturnSnapshotState = {
  namespace?: string;
  savedAt?: number;
  currentPage?: number;
  images?: CloudflareImage[];
};

type StoredGalleryPreferences = {
  variant: string;
  onlyCanonical: boolean;
  respectAspectRatio: boolean;
  onlyWithVariants: boolean;
  showMotionAssetsOnly: boolean;
  showComfyOnly: boolean;
  embeddingFilter: EmbeddingFilter;
  selectedFolder: string;
  selectedTag: string;
  searchTerm: string;
  colorSearchHex?: string | null;
  viewMode: 'grid' | 'list';
  gridSize: GridSize;
  filtersCollapsed: boolean;
  bulkFolderInput: string;
  bulkFolderMode: 'existing' | 'new';
  showDuplicatesOnly: boolean;
  showBrokenOnly: boolean;
  aspectRatioFilters: Array<'horizontal' | 'vertical' | 'square'>;
  hiddenFolders: string[];
  hiddenTags: string[];
  showCli: boolean;
  controlsVisible: boolean;
  pageSize: number;
  dateFilter: DateFilter | null;
  currentPage: number;
};

type VideoMetaState = {
  enabled: boolean;
  limit: number;
  returned: number;
  totalScoped: number;
  truncated: boolean;
} | null;

export const buildGalleryImagesUrl = ({
  forceRefresh = false,
  namespace,
  videoLimitOverride,
  includeExtrasForGallery = false,
  showMotionAssetsOnly = false,
}: {
  forceRefresh?: boolean;
  namespace?: string;
  videoLimitOverride?: number | null;
  includeExtrasForGallery?: boolean;
  showMotionAssetsOnly?: boolean;
}) => {
  const params = new URLSearchParams();
  if (forceRefresh) {
    params.set('refresh', '1');
  }
  if (namespace === '') {
    params.set('namespace', '__none__');
  } else if (namespace === '__all__') {
    params.set('namespace', '__all__');
  } else if (namespace && namespace !== '__all__') {
    params.set('namespace', namespace);
  }
  if (videoLimitOverride && videoLimitOverride > 0) {
    params.set('videoLimit', String(videoLimitOverride));
  }
  if (includeExtrasForGallery) {
    params.set('includeExtras', '1');
  }
  if (showMotionAssetsOnly) {
    params.set('mediaFilter', 'animated');
  }
  const query = params.toString();
  return query ? `/api/images?${query}` : '/api/images';
};

let galleryWarmCache: GalleryWarmCacheState | null = null;

type BulkState = {
  bulkSelectionMode: boolean;
  bulkEditOpen: boolean;
  bulkFolderInput: string;
  bulkFolderMode: 'existing' | 'new';
  bulkTagsInput: string;
  bulkTagsAiCount: string;
  bulkApplyFolder: boolean;
  bulkApplyTags: boolean;
  bulkTagsMode: 'replace' | 'append' | 'ai';
  bulkApplyDisplayName: boolean;
  bulkDisplayNameMode: 'custom' | 'auto' | 'clear' | 'ai';
  bulkDisplayNameInput: string;
  bulkApplyDescription: boolean;
  bulkDescriptionAppendInput: string;
  bulkApplyNamespace: boolean;
  bulkNamespaceInput: string;
  bulkUpdating: boolean;
  bulkDeleting: boolean;
  bulkEmbeddingGenerating: boolean;
  bulkAnimateFps: string;
  bulkAnimateTouched: boolean;
  bulkAnimateLoop: boolean;
  bulkAnimateFilename: string;
  bulkAnimateLoading: boolean;
  bulkAnimateError: string | null;
};

type BulkAction =
  | { type: 'set'; field: keyof BulkState; value: BulkState[keyof BulkState] }
  | { type: 'resetEdit' };

const bulkReducer = (state: BulkState, action: BulkAction): BulkState => {
  switch (action.type) {
    case 'set':
      return {
        ...state,
        [action.field]: action.value,
      };
    case 'resetEdit':
      return {
        ...state,
        bulkEditOpen: true,
        bulkFolderInput: '',
        bulkFolderMode: 'existing',
        bulkTagsInput: '',
        bulkTagsAiCount: '6',
        bulkApplyFolder: false,
        bulkApplyTags: true,
        bulkTagsMode: 'append',
        bulkApplyDisplayName: false,
        bulkDisplayNameMode: 'custom',
        bulkDisplayNameInput: '',
        bulkApplyDescription: false,
        bulkDescriptionAppendInput: '',
        bulkApplyNamespace: false,
        bulkNamespaceInput: '',
        bulkAnimateFps: '',
        bulkAnimateTouched: false,
        bulkAnimateLoop: true,
        bulkAnimateFilename: '',
        bulkAnimateError: null,
      };
    default:
      return state;
  }
};

export const getDefaultStoredPreferences = (): StoredGalleryPreferences => ({
  variant: 'full',
  onlyCanonical: false,
  respectAspectRatio: false,
  onlyWithVariants: false,
  showMotionAssetsOnly: false,
  showComfyOnly: false,
  embeddingFilter: 'none',
  selectedFolder: 'all',
  selectedTag: '',
  searchTerm: '',
  colorSearchHex: null,
  viewMode: 'grid',
  gridSize: DEFAULT_GRID_SIZE,
  filtersCollapsed: false,
  bulkFolderInput: '',
  bulkFolderMode: 'existing',
  showDuplicatesOnly: false,
  showBrokenOnly: false,
  aspectRatioFilters: [],
  hiddenFolders: [],
  hiddenTags: [],
  showCli: true,
  controlsVisible: true,
  pageSize: DEFAULT_PAGE_SIZE,
  dateFilter: null,
  currentPage: 1,
});

export const getStoredPreferences = (
  namespace: string | undefined,
  initialGalleryReturnState: NormalizedGalleryReturnState | null
): StoredGalleryPreferences => {
  if (typeof window === 'undefined') {
    return getDefaultStoredPreferences();
  }

  const next = getDefaultStoredPreferences();

  try {
    const stored = window.localStorage.getItem('galleryPreferences');
    if (stored) {
      const parsed = JSON.parse(stored) as {
        variant?: string;
        onlyCanonical?: boolean;
        respectAspectRatio?: boolean;
        onlyWithVariants?: boolean;
        showMotionAssetsOnly?: boolean;
        showComfyOnly?: boolean;
        selectedFolder?: string;
        selectedTag?: string;
        searchTerm?: string;
        colorSearchHex?: string | null;
        viewMode?: 'grid' | 'list';
        gridSize?: GridSize;
        filtersCollapsed?: boolean;
        bulkFolderInput?: string;
        bulkFolderMode?: 'existing' | 'new';
        showDuplicatesOnly?: boolean;
        showBrokenOnly?: boolean;
        aspectRatioFilters?: ('horizontal' | 'vertical' | 'square')[];
        showCli?: boolean;
        controlsVisible?: boolean;
        pageSize?: number;
        dateFilter?: { startDate?: string; endDate?: string } | { year?: number; month?: number } | null;
        currentPage?: number;
      };

      const rawPageSize = typeof parsed.pageSize === 'number' ? parsed.pageSize : DEFAULT_PAGE_SIZE;
      const normalizedPageSize = PAGE_SIZE_OPTIONS.includes(rawPageSize)
        ? rawPageSize
        : DEFAULT_PAGE_SIZE;
      const storedVariant = typeof parsed.variant === 'string' ? parsed.variant : 'full';

      next.variant = storedVariant === 'public' || storedVariant === 'original' ? 'full' : storedVariant;
      next.onlyCanonical = Boolean(parsed.onlyCanonical);
      next.respectAspectRatio = Boolean(parsed.respectAspectRatio);
      next.onlyWithVariants = Boolean(parsed.onlyWithVariants);
      next.showMotionAssetsOnly = Boolean(parsed.showMotionAssetsOnly);
      next.showComfyOnly = Boolean(parsed.showComfyOnly);
      next.selectedFolder = parsed.selectedFolder ?? 'all';
      next.selectedTag = parsed.selectedTag ?? '';
      next.searchTerm = parsed.searchTerm ?? '';
      next.colorSearchHex =
        typeof parsed.colorSearchHex === 'string' && parsed.colorSearchHex.trim()
          ? parsed.colorSearchHex.trim()
          : null;
      next.viewMode = parsed.viewMode === 'list' ? 'list' : 'grid';
      next.gridSize = normalizeGridSize(parsed.gridSize, DEFAULT_GRID_SIZE);
      next.filtersCollapsed = Boolean(parsed.filtersCollapsed);
      next.bulkFolderInput = typeof parsed.bulkFolderInput === 'string' ? parsed.bulkFolderInput : '';
      next.bulkFolderMode = parsed.bulkFolderMode === 'new' ? 'new' : 'existing';
      next.showDuplicatesOnly = Boolean(parsed.showDuplicatesOnly);
      next.showBrokenOnly = Boolean(parsed.showBrokenOnly);
      next.aspectRatioFilters = Array.isArray(parsed.aspectRatioFilters)
        ? parsed.aspectRatioFilters.filter((value) => value === 'horizontal' || value === 'vertical' || value === 'square')
        : [];
      next.showCli = parsed.showCli !== false;
      next.controlsVisible = parsed.controlsVisible !== false;
      next.pageSize = normalizedPageSize;
      next.dateFilter = normalizeDateFilterValue(parsed.dateFilter);
      next.currentPage =
        typeof parsed.currentPage === 'number' && parsed.currentPage > 0
          ? Math.floor(parsed.currentPage)
          : 1;
    }
  } catch (error) {
    console.warn('Failed to parse gallery preferences', error);
  }

  if (initialGalleryReturnState?.filters) {
    next.searchTerm = initialGalleryReturnState.filters.searchTerm;
    next.colorSearchHex = initialGalleryReturnState.filters.colorSearchHex ?? null;
    next.selectedFolder = initialGalleryReturnState.filters.selectedFolder;
    next.selectedTag = initialGalleryReturnState.filters.selectedTag;
    next.onlyCanonical = initialGalleryReturnState.filters.onlyCanonical;
    next.onlyWithVariants = initialGalleryReturnState.filters.onlyWithVariants;
    next.showMotionAssetsOnly = initialGalleryReturnState.filters.showMotionAssetsOnly;
    next.showDuplicatesOnly = initialGalleryReturnState.filters.showDuplicatesOnly;
    next.showBrokenOnly = initialGalleryReturnState.filters.showBrokenOnly;
    next.showComfyOnly = initialGalleryReturnState.filters.showComfyOnly;
    next.embeddingFilter = initialGalleryReturnState.filters.embeddingFilter;
    next.aspectRatioFilters = initialGalleryReturnState.filters.aspectRatioFilters;
    next.dateFilter = initialGalleryReturnState.filters.dateFilter;
    next.hiddenFolders = initialGalleryReturnState.filters.hiddenFolders;
    next.hiddenTags = initialGalleryReturnState.filters.hiddenTags;
    next.pageSize = initialGalleryReturnState.filters.pageSize;
    next.currentPage = initialGalleryReturnState.filters.currentPage;
    return next;
  }

  if (initialGalleryReturnState?.currentPage) {
    next.currentPage = initialGalleryReturnState.currentPage;
    return next;
  }

  try {
    const params = new URLSearchParams(window.location.search);
    const gns = params.get('gns') ?? '';
    const gpage = params.get('gpage');
    const gcolor = normalizeColorSearchHex(params.get('gcolor'));
    const activeNamespace = namespace ?? '';
    if (gns === activeNamespace && gpage) {
      const parsedPage = Number.parseInt(gpage, 10);
      if (Number.isFinite(parsedPage) && parsedPage > 0) {
        next.currentPage = parsedPage;
      }
    }
    if (gns === activeNamespace && gcolor) {
      next.colorSearchHex = gcolor;
    }
  } catch {
    // ignore
  }

  return next;
};



const ImageGallery = forwardRef<ImageGalleryRef, ImageGalleryProps>(
  ({ refreshTrigger, namespace, onNamespaceChange }, ref) => {
  const initialGalleryReturnStateRef = useRef<NormalizedGalleryReturnState | null>(
    getFreshGalleryReturnState()
  );
  const storedPreferencesRef = useRef(
    getStoredPreferences(namespace, initialGalleryReturnStateRef.current)
  );

  const initialReturningFromDetail = (() => {
    if (initialGalleryReturnStateRef.current) return true;
    if (typeof window === 'undefined') return false;
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('gpage')) return true;
    } catch {
      // ignore
    }
    return false;
  })();

  const initialWarmImages = (() => {
    if (!initialReturningFromDetail) {
      return [] as CloudflareImage[];
    }
    const activeNamespace = namespace ?? '';
    if (!galleryWarmCache) {
      return [] as CloudflareImage[];
    }
    if (galleryWarmCache.namespace !== activeNamespace) {
      return [] as CloudflareImage[];
    }
    if (Date.now() - galleryWarmCache.savedAt > GALLERY_RETURN_TTL_MS) {
      return [] as CloudflareImage[];
    }
    return galleryWarmCache.images;
  })();

  const initialSnapshotImages = (() => {
    if (!initialReturningFromDetail || typeof window === 'undefined') {
      return [] as CloudflareImage[];
    }
    const activeNamespace = namespace ?? '';
    try {
      const rawSnapshot = window.sessionStorage.getItem(GALLERY_RETURN_SNAPSHOT_KEY);
      if (!rawSnapshot) {
        return [] as CloudflareImage[];
      }
      const parsed = JSON.parse(rawSnapshot) as GalleryReturnSnapshotState;
      const savedNamespace = typeof parsed?.namespace === 'string' ? parsed.namespace : '';
      const savedAt = typeof parsed?.savedAt === 'number' ? parsed.savedAt : 0;
      const freshEnough = !savedAt || Date.now() - savedAt < GALLERY_RETURN_TTL_MS;
      if (!freshEnough || savedNamespace !== activeNamespace || !Array.isArray(parsed?.images)) {
        return [] as CloudflareImage[];
      }
      const snapshotImages = parsed.images.filter(
        (image): image is CloudflareImage => Boolean(image) && typeof image.id === 'string'
      );
      if (snapshotImages.length > 0) {
        galleryWarmCache = {
          namespace: activeNamespace,
          images: snapshotImages,
          savedAt: savedAt || Date.now(),
        };
      }
      return snapshotImages;
    } catch {
      return [] as CloudflareImage[];
    }
  })();

  const returningFromDetailRef = useRef(initialReturningFromDetail);
  const initialSilentFetchRef = useRef(initialWarmImages.length > 0 || initialSnapshotImages.length > 0);
  const deferInitialFetchRef = useRef(initialReturningFromDetail && initialSnapshotImages.length > 0);

  const [images, setImages] = useState<CloudflareImage[]>(
    initialSnapshotImages.length > 0 ? initialSnapshotImages : initialWarmImages
  );
  const [loading, setLoading] = useState(initialWarmImages.length === 0 && initialSnapshotImages.length === 0);
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
  const [compactScrollMode, setCompactScrollMode] = useState(!(storedPreferencesRef.current.controlsVisible ?? true));
  const [bulkState, dispatchBulk] = useReducer(
    bulkReducer,
    {
      bulkSelectionMode: false,
      bulkEditOpen: false,
      bulkFolderInput: storedPreferencesRef.current.bulkFolderInput ?? '',
      bulkFolderMode: (storedPreferencesRef.current.bulkFolderMode ?? 'existing') as 'existing' | 'new',
      bulkTagsInput: '',
      bulkTagsAiCount: '6',
      bulkApplyFolder: true,
      bulkApplyTags: false,
      bulkTagsMode: 'replace',
      bulkApplyDisplayName: false,
      bulkDisplayNameMode: 'custom',
      bulkDisplayNameInput: '',
      bulkApplyDescription: false,
      bulkDescriptionAppendInput: '',
      bulkApplyNamespace: false,
      bulkNamespaceInput: '',
      bulkUpdating: false,
      bulkDeleting: false,
      bulkEmbeddingGenerating: false,
      bulkAnimateFps: '',
      bulkAnimateTouched: false,
      bulkAnimateLoop: true,
      bulkAnimateFilename: '',
      bulkAnimateLoading: false,
      bulkAnimateError: null,
    }
  );
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
    bulkAnimateFilename,
    bulkAnimateLoading,
    bulkAnimateError,
  } = bulkState;

  const setBulkField = useCallback(<K extends keyof BulkState>(field: K, value: BulkState[K]) => {
    dispatchBulk({ type: 'set', field, value });
  }, []);

  const setBulkSelectionMode = useCallback((value: boolean) => setBulkField('bulkSelectionMode', value), [setBulkField]);
  const setBulkEditOpen = useCallback((value: boolean) => setBulkField('bulkEditOpen', value), [setBulkField]);
  const setBulkFolderInput = useCallback((value: string) => setBulkField('bulkFolderInput', value), [setBulkField]);
  const setBulkFolderMode = useCallback((value: 'existing' | 'new') => setBulkField('bulkFolderMode', value), [setBulkField]);
  const setBulkTagsInput = useCallback((value: string) => setBulkField('bulkTagsInput', value), [setBulkField]);
  const setBulkTagsAiCount = useCallback((value: string) => setBulkField('bulkTagsAiCount', value), [setBulkField]);
  const setBulkApplyFolder = useCallback((value: boolean) => setBulkField('bulkApplyFolder', value), [setBulkField]);
  const setBulkApplyTags = useCallback((value: boolean) => setBulkField('bulkApplyTags', value), [setBulkField]);
  const setBulkTagsMode = useCallback((value: 'replace' | 'append' | 'ai') => setBulkField('bulkTagsMode', value), [setBulkField]);
  const setBulkApplyDisplayName = useCallback((value: boolean) => setBulkField('bulkApplyDisplayName', value), [setBulkField]);
  const setBulkDisplayNameMode = useCallback((value: 'custom' | 'auto' | 'clear' | 'ai') => setBulkField('bulkDisplayNameMode', value), [setBulkField]);
  const setBulkDisplayNameInput = useCallback((value: string) => setBulkField('bulkDisplayNameInput', value), [setBulkField]);
  const setBulkApplyDescription = useCallback((value: boolean) => setBulkField('bulkApplyDescription', value), [setBulkField]);
  const setBulkDescriptionAppendInput = useCallback((value: string) => setBulkField('bulkDescriptionAppendInput', value), [setBulkField]);
  const setBulkApplyNamespace = useCallback((value: boolean) => setBulkField('bulkApplyNamespace', value), [setBulkField]);
  const setBulkNamespaceInput = useCallback((value: string) => setBulkField('bulkNamespaceInput', value), [setBulkField]);
  const setBulkUpdating = useCallback((value: boolean) => setBulkField('bulkUpdating', value), [setBulkField]);
  const setBulkDeleting = useCallback((value: boolean) => setBulkField('bulkDeleting', value), [setBulkField]);
  const setBulkEmbeddingGenerating = useCallback((value: boolean) => setBulkField('bulkEmbeddingGenerating', value), [setBulkField]);
  const setBulkAnimateFps = useCallback((value: string) => setBulkField('bulkAnimateFps', value), [setBulkField]);
  const setBulkAnimateTouched = useCallback((value: boolean) => setBulkField('bulkAnimateTouched', value), [setBulkField]);
  const setBulkAnimateLoop = useCallback((value: boolean) => setBulkField('bulkAnimateLoop', value), [setBulkField]);
  const setBulkAnimateFilename = useCallback((value: string) => setBulkField('bulkAnimateFilename', value), [setBulkField]);
  const setBulkAnimateLoading = useCallback((value: boolean) => setBulkField('bulkAnimateLoading', value), [setBulkField]);
  const setBulkAnimateError = useCallback((value: string | null) => setBulkField('bulkAnimateError', value), [setBulkField]);
  const [refreshingCache, setRefreshingCache] = useState(false);
  const [namespaceSettingsOpen, setNamespaceSettingsOpen] = useState(false);
  const [namespaceDraft, setNamespaceDraft] = useState(namespace ?? '');
  const [namespaceSelectValue, setNamespaceSelectValue] = useState('');
  const [registryNamespaces, setRegistryNamespaces] = useState<string[]>([]);
  const [videoLimitOverride, setVideoLimitOverride] = useState<number | null>(null);
  const [includeExtrasForGallery, setIncludeExtrasForGallery] = useState(
    isLikelySourceSearchTerm(storedPreferencesRef.current.searchTerm ?? '')
  );
  const [videoMeta, setVideoMeta] = useState<VideoMetaState>(null);
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
  const utilityButtonClasses = 'text-[0.65rem] font-mono px-3 py-1 rounded-full bg-white/10 hover:bg-white/20 transition';
  const didRestoreReturnStateRef = useRef(false);

  // Keep ref in sync with state for use in effects without triggering re-runs
  useEffect(() => {
    promptThisMapRef.current = promptThisMap;
  }, [promptThisMap]);

  useEffect(() => {
    const next = namespace ?? '';
    setNamespaceDraft(next === '__all__' ? '' : next);
    setNamespaceSelectValue(next || '');
  }, [namespace]);

  const fetchNamespaces = useCallback(async (cache: RequestCache = 'default') => {
    try {
      const response = await fetch('/api/namespaces', { cache });
      const data = await response.json();
      const payload = Array.isArray(data?.namespaces) ? data.namespaces : [];
      setRegistryNamespaces(payload.filter((entry: unknown): entry is string => typeof entry === 'string'));
    } catch (error) {
      console.warn('Failed to load namespace registry', error);
    }
  }, []);

  useEffect(() => {
    void fetchNamespaces('no-store');
  }, [fetchNamespaces]);

  const namespaceOptions = useMemo(() => {
    const rawSeen = new Set(images.map((image) => image.namespace).filter((ns): ns is string => Boolean(ns)));
    const envDefault = process.env.NEXT_PUBLIC_IMAGE_NAMESPACE || '';
    const knownRaw = process.env.NEXT_PUBLIC_KNOWN_NAMESPACES || '';
    const registryRaw = registryNamespaces;
    
    // Explicitly known items
    const defaults = new Set<string>();
    if (envDefault) defaults.add(envDefault);
    
    // Configured known items
    const known = new Set<string>();
    knownRaw.split(',').map(s => s.trim()).filter(Boolean).forEach(s => {
      // Don't duplicate if it's already the default
      if (!defaults.has(s)) known.add(s);
    });

    const registry = new Set<string>();
    registryRaw.map((entry) => entry.trim()).filter(Boolean).forEach((entry) => {
      if (!defaults.has(entry) && !known.has(entry)) {
        registry.add(entry);
      }
    });

    // Discovered from current image set
    const discovered = new Set<string>();
    rawSeen.forEach(s => {
      if (!defaults.has(s) && !known.has(s) && !registry.has(s)) {
        discovered.add(s);
      }
    });

    const options = [
      { value: '__all__', label: 'All namespaces' },
      { value: '', label: '(no namespace)' },
    ];

    if (defaults.size > 0) {
      defaults.forEach(val => options.push({ value: val, label: `${val} (default)` }));
    }

    if (known.size > 0) {
      const sorted = Array.from(known).sort();
      sorted.forEach(val => options.push({ value: val, label: val }));
    }

    if (registry.size > 0) {
      const sorted = Array.from(registry).sort();
      sorted.forEach(val => options.push({ value: val, label: `${val} (registry)` }));
    }

    if (discovered.size > 0) {
      const sorted = Array.from(discovered).sort();
      sorted.forEach(val => options.push({ value: val, label: `${val} (discovered)` }));
    }

    options.push({ value: '__custom__', label: 'Enter manually...' });

    // Ensure the currently selected one is present if it wasn't covered above
    if (namespace && !options.some((opt) => opt.value === namespace) && namespace !== '__custom__') {
       // Check if we haven't added it (it might be __none__ which maps to '')
       options.splice(options.length - 1, 0, { value: namespace, label: namespace });
    }

    return options;
  }, [images, namespace, registryNamespaces]);

  const namespaceLabel = namespace === '__all__' ? 'All namespaces' : namespace;

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
  
  // Hover preview state
  const [hoveredImage, setHoveredImage] = useState<string | null>(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [showPreview, setShowPreview] = useState(false);
  const [utilityExpanded, setUtilityExpanded] = useState(false);
  const galleryTopRef = useRef<HTMLDivElement | null>(null);
  const chromeManualModeRef = useRef<GalleryChromeManualMode>(
    (storedPreferencesRef.current.controlsVisible ?? true) ? 'auto' : 'hidden'
  );
  const lastScrollYRef = useRef(0);
  const scrollFrameRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const initialLoadStartedAtRef = useRef<number>(typeof performance !== 'undefined' ? performance.now() : Date.now());
  const initialLoadLoggedRef = useRef(false);
  const videoAutoExpandPageRef = useRef<number | null>(null);
  const showMotionAssetsOnlyRef = useRef(storedPreferencesRef.current.showMotionAssetsOnly ?? false);
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

  const applyGalleryChromeState = useCallback((controlsVisible: boolean, compactMode: boolean) => {
    setGalleryControlsVisible((prev) => (prev === controlsVisible ? prev : controlsVisible));
    setCompactScrollMode((prev) => (prev === compactMode ? prev : compactMode));
  }, []);

  const toggleGalleryControls = useCallback(() => {
    const shouldShow = !galleryControlsVisible;
    const nextManualMode: GalleryChromeManualMode = shouldShow ? 'shown' : 'hidden';
    chromeManualModeRef.current = nextManualMode;
    setControlsVisiblePreference(shouldShow);
    applyGalleryChromeState(shouldShow, !shouldShow);
  }, [applyGalleryChromeState, galleryControlsVisible]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (loading) return;

    const updateChromeState = () => {
      scrollFrameRef.current = null;
      const galleryTop = galleryTopRef.current
        ? galleryTopRef.current.getBoundingClientRect().top + window.scrollY
        : 0;
      const next = resolveGalleryChromeScrollState({
        currentScrollY: window.scrollY,
        lastScrollY: lastScrollYRef.current,
        galleryTop,
        manualMode: chromeManualModeRef.current,
        controlsVisible: galleryControlsVisible,
      });

      lastScrollYRef.current = window.scrollY;
      chromeManualModeRef.current = next.manualMode;
      applyGalleryChromeState(next.controlsVisible, next.compactMode);
    };

    const scheduleChromeStateUpdate = () => {
      if (scrollFrameRef.current !== null) {
        return;
      }
      scrollFrameRef.current = window.requestAnimationFrame(updateChromeState);
    };

    lastScrollYRef.current = window.scrollY;
    updateChromeState();

    window.addEventListener('scroll', scheduleChromeStateUpdate, { passive: true });
    window.addEventListener('resize', scheduleChromeStateUpdate);

    return () => {
      window.removeEventListener('scroll', scheduleChromeStateUpdate);
      window.removeEventListener('resize', scheduleChromeStateUpdate);
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    };
  }, [applyGalleryChromeState, galleryControlsVisible, loading]);

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
      const url = buildGalleryImagesUrl({
        forceRefresh,
        namespace,
        videoLimitOverride,
        includeExtrasForGallery,
        showMotionAssetsOnly: showMotionAssetsOnlyRef.current,
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
        galleryWarmCache = {
          namespace: namespace ?? '',
          images: uniqueImages,
          savedAt: Date.now(),
        };
        if (PERF_LOGGING_ENABLED) {
          const elapsedMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt;
          const serverTiming = response.headers.get('server-timing') ?? 'n/a';
          const stageTiming = data?.timings ? JSON.stringify(data.timings) : '{}';
          console.info(
            `[GalleryPerf] /api/images ${Math.round(elapsedMs)}ms (silent=${silent}, refresh=${forceRefresh}, count=${uniqueImages.length}) server_timing=${serverTiming} stages=${stageTiming}`
          );
        }
        if (syncNamespaces || forceRefresh) {
          void fetchNamespaces('no-store');
        }
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      console.error('Failed to fetch images:', error);
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
      `[GalleryPerf] initial_render ${Math.round(elapsedMs)}ms (images=${images.length}, returningFromDetail=${returningFromDetailRef.current})`
    );
  }, [images.length, loading, PERF_LOGGING_ENABLED]);

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
      const useIdleCallback = typeof window !== 'undefined' && 'requestIdleCallback' in window;
      const scheduled = useIdleCallback
        ? window.requestIdleCallback(() => {
            fetchImages({ silent: true });
          })
        : window.setTimeout(() => {
            fetchImages({ silent: true });
          }, 250);
      return () => {
        if (useIdleCallback && typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
          window.cancelIdleCallback(scheduled);
        } else {
          window.clearTimeout(scheduled as number);
        }
      };
    }
    const shouldSilentFetch = initialSilentFetchRef.current;
    initialSilentFetchRef.current = false;
    fetchImages({ silent: shouldSilentFetch });
  }, [namespace, fetchImages]);

  const toast = useToast();

  const clearColorSearch = useCallback(() => {
    setColorSearchHex(null);
    setColorSearchRows([]);
    setColorSearchError(null);
    setColorSearchLoading(false);
  }, []);

  const [backupInfo, setBackupInfo] = useState<{
    timestamp: string;
    date: Date;
    sizeHuman: string;
    type: 'bundle' | 'rdb';
  } | null>(null);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);

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

  const parseBackupTimestamp = useCallback((timestamp: string) => {
    const match = timestamp.match(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})([+-]\d{4})?/);
    if (!match) return null;
    const [, year, month, day, hour, minute, second, tzOffset] = match;
    const utcMs = Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second)
    );
    if (!tzOffset) {
      return new Date(utcMs);
    }
    const sign = tzOffset.startsWith('-') ? -1 : 1;
    const offsetHours = Number(tzOffset.slice(1, 3));
    const offsetMinutes = Number(tzOffset.slice(3, 5));
    const offsetTotalMinutes = sign * (offsetHours * 60 + offsetMinutes);
    return new Date(utcMs - offsetTotalMinutes * 60 * 1000);
  }, []);

  const fetchLatestBackup = useCallback(async () => {
    try {
      setBackupError(null);
      const response = await fetch('/api/backup');
      if (!response.ok) {
        throw new Error('Failed to load backups');
      }
      const data = await response.json();
      const backups = (data?.backups ?? []) as Array<{
        timestamp: string;
        sizeHuman: string;
        type: 'bundle' | 'rdb';
      }>;
      if (!backups.length) {
        setBackupInfo(null);
        return;
      }
      const latestTimestamp = backups
        .map((b) => b.timestamp)
        .sort()
        .reverse()[0];
      const latestBundle = backups.find(
        (b) => b.timestamp === latestTimestamp && b.type === 'bundle'
      );
      const latestRdb = backups.find(
        (b) => b.timestamp === latestTimestamp && b.type === 'rdb'
      );
      const chosen = latestBundle ?? latestRdb;
      if (!chosen) {
        setBackupInfo(null);
        return;
      }
      const date = parseBackupTimestamp(chosen.timestamp);
      if (!date) {
        setBackupInfo(null);
        return;
      }
      setBackupInfo({
        timestamp: chosen.timestamp,
        date,
        sizeHuman: chosen.sizeHuman,
        type: chosen.type,
      });
    } catch (error) {
      console.error('Failed to load backup info', error);
      setBackupError(error instanceof Error ? error.message : 'Backup info unavailable');
    }
  }, [parseBackupTimestamp]);

  useEffect(() => {
    fetchLatestBackup();
  }, [fetchLatestBackup]);

  const handleCreateBackup = useCallback(async () => {
    try {
      setBackupLoading(true);
      setBackupError(null);
      const response = await fetch('/api/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to create backup');
      }
      toast.push('Backup created');
      await fetchLatestBackup();
    } catch (error) {
      console.error('Backup failed', error);
      setBackupError(error instanceof Error ? error.message : 'Backup failed');
      toast.push('Backup failed');
    } finally {
      setBackupLoading(false);
    }
  }, [fetchLatestBackup, toast]);

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

  // Helper function to get orientation icon based on aspect ratio
  const getOrientationIcon = (aspectRatioString: string) => {
    // Parse the aspect ratio to determine orientation
    const parts = aspectRatioString.split(':');
    if (parts.length === 2) {
      const width = parseFloat(parts[0]);
      const height = parseFloat(parts[1]);
      const ratio = width / height;
      
      if (Math.abs(ratio - 1) < 0.1) {
        // Square (1:1 or close)
        return (
          <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" className="inline-block">
            <rect x="1" y="1" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="0.8"/>
          </svg>
        );
      } else if (ratio > 1) {
        // Landscape (wider than tall)
        return (
          <svg width="10" height="6" viewBox="0 0 10 6" fill="currentColor" className="inline-block">
            <rect x="1" y="1" width="8" height="4" fill="none" stroke="currentColor" strokeWidth="0.8"/>
          </svg>
        );
      } else {
        // Portrait (taller than wide)
        return (
          <svg width="6" height="10" viewBox="0 0 6 10" fill="currentColor" className="inline-block">
            <rect x="1" y="1" width="4" height="8" fill="none" stroke="currentColor" strokeWidth="0.8"/>
          </svg>
        );
      }
    }
    
    // Default to square if we can't parse
    return (
      <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" className="inline-block">
        <rect x="1" y="1" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="0.8"/>
      </svg>
    );
  };

  // Component for displaying aspect ratio
  const AspectRatioDisplay: React.FC<{ imageId: string }> = ({ imageId }) => {
    const { aspectRatio, loading, error } = useImageAspectRatio(imageId);

    if (loading) {
      return (
        <p className="text-sm font-mono text-gray-400">
          📐 <span className="inline-block w-8 h-2 bg-gray-200 rounded animate-pulse"></span>
        </p>
      );
    }

    if (error || !aspectRatio) {
      return <p className="text-sm font-mono text-gray-400">📐 --</p>;
    }

    return (
      <p className="text-[0.6rem] font-mono text-gray-500 flex items-center gap-1">
        📐 {aspectRatio} {getOrientationIcon(aspectRatio)}
      </p>
    );
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
    initialPreferences: {
      selectedFolder: storedPreferencesRef.current.selectedFolder ?? 'all',
      selectedTag: storedPreferencesRef.current.selectedTag ?? '',
      searchTerm: storedPreferencesRef.current.searchTerm ?? '',
      onlyCanonical: storedPreferencesRef.current.onlyCanonical,
      respectAspectRatio: storedPreferencesRef.current.respectAspectRatio,
      onlyWithVariants: storedPreferencesRef.current.onlyWithVariants,
      showMotionAssetsOnly: storedPreferencesRef.current.showMotionAssetsOnly ?? false,
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

  useEffect(() => {
    if (showMotionAssetsOnlyRef.current === showMotionAssetsOnly) return;
    showMotionAssetsOnlyRef.current = showMotionAssetsOnly;
    void fetchImages({ silent: true });
  }, [showMotionAssetsOnly, fetchImages]);

  const uniqueFolders = useMemo(() => {
    const folderNames = images
      .map(img => img.folder?.trim())
      .filter((folder): folder is string => Boolean(folder));
    return Array.from(new Set(folderNames)).sort((a, b) => a.localeCompare(b));
  }, [images]);
  const visibleFolders = useMemo(
    () => uniqueFolders.filter(folder => !hiddenFolders.includes(folder)),
    [uniqueFolders, hiddenFolders]
  );

  const saveGalleryReturnState = useCallback((imageId: string) => {
    if (typeof window === 'undefined') return;
    try {
      const resultIds = filteredImages.map((img) => img.id);
      const savedAt = Date.now();
      persistGalleryReturnState({
        scrollY: window.scrollY,
        namespace: namespace ?? '',
        savedAt,
        selectedImageId: imageId,
        resultIds,
        resultAssets: filteredImages.map((img) => ({
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
        } as GalleryReturnSnapshotState)
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
          ? 'Selected duplicates (keeping newest copy per filename)'
          : 'Selected duplicates (keeping oldest copy per filename)'
      );
    },
    [selectDuplicatesKeepSingleBase, toast]
  );

  const { deleteImage, generateAltTag, generateDisplayName, startEdit, cancelEdit, saveEdit } = useGalleryItemActions({
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
      toast.push('Select at least one image');
      return;
    }
    dispatchBulk({ type: 'resetEdit' });
  }, [selectedCount, toast]);

  const closeBulkEditModal = useCallback(() => {
    setBulkEditOpen(false);
  }, [setBulkEditOpen]);

  const duplicateGroupCount = duplicateGroups.length;
  const duplicateImageCount = duplicateIds.size;

  const uniqueTags = useMemo(() => {
    const tags = Array.from(
      new Set(images.flatMap(img => Array.isArray(img.tags) ? img.tags.filter(tag => tag && tag.trim()) : []))
    );
    return tags.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [images]);

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

  const handleNamespaceSelectChange = useCallback(
    (value: string) => {
      setNamespaceSelectValue(value);
      if (value === '__custom__') {
        return;
      }
      setNamespaceDraft(value);
      onNamespaceChange?.(value);
      setNamespaceSettingsOpen(false);
    },
    [onNamespaceChange]
  );

  const handleNamespaceDraftChange = useCallback((value: string) => {
    setNamespaceDraft(value);
    setNamespaceSelectValue('__custom__');
  }, []);

  const handleNamespaceSave = useCallback(() => {
    const next = namespaceSelectValue === '__custom__'
      ? namespaceDraft.trim()
      : namespaceSelectValue;
    onNamespaceChange?.(next);
    setNamespaceSettingsOpen(false);
  }, [namespaceDraft, namespaceSelectValue, onNamespaceChange]);

  const viewFilters = useMemo(() => ({
    images: pageImages,
    selectedVariant,
    respectAspectRatio,
    bulkSelectionMode,
    selectedImageIds,
    duplicateIds,
    childrenMap,
    colorMetadataMap,
    embeddingPendingMap,
    altLoadingMap,
    displayNameLoadingMap,
    galleryReturnHrefSuffix,
    activeColorSearchHex: colorSearchHex,
  }), [
    pageImages,
    selectedVariant,
    respectAspectRatio,
    bulkSelectionMode,
    selectedImageIds,
    duplicateIds,
    childrenMap,
    colorMetadataMap,
    embeddingPendingMap,
    altLoadingMap,
    displayNameLoadingMap,
    galleryReturnHrefSuffix,
    colorSearchHex,
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
  const backupAgeDays = backupInfo
    ? (Date.now() - backupInfo.date.getTime()) / (1000 * 60 * 60 * 24)
    : null;
  const backupAgeLabel = backupAgeDays !== null ? `${backupAgeDays.toFixed(1)}d old` : '—';
  const backupTimeLabel = backupInfo ? backupInfo.date.toLocaleString() : '—';
  const backupSizeLabel = backupInfo ? backupInfo.sizeHuman : '—';

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
        className="sticky top-0 z-[3000] -m-6 mb-6 overflow-hidden rounded-t-lg border-b border-gray-100 bg-white/95 backdrop-blur"
      >
        <GalleryCompactHeader
          filteredCount={filteredWithVariants.length}
          totalCount={images.length}
          pageIndex={pageIndex}
          totalPages={totalPages}
          controlsVisible={galleryControlsVisible}
          onToggleControls={toggleGalleryControls}
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

      {duplicateGroupCount > 0 && (
        <div className="mb-4 flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[0.65rem] font-mono text-amber-900">
          <div>
            Found {duplicateGroupCount} duplicate group{duplicateGroupCount === 1 ? '' : 's'} affecting {duplicateImageCount} image{duplicateImageCount === 1 ? '' : 's'} (must match both original URL and content hash).
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

      {colorSearchHex && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-[0.65rem] font-mono text-violet-900">
          <span className="rounded-full border border-violet-300 bg-white px-2 py-0.5">
            Color: {colorSearchHex}
          </span>
          {colorSearchLoading && <span className="text-violet-700">Searching nearby colors…</span>}
          {!colorSearchLoading && colorSearchError && (
            <span className="text-red-700">Search failed: {colorSearchError}</span>
          )}
          {!colorSearchLoading && !colorSearchError && (
            <span>{filteredWithVariants.length.toLocaleString()} result{filteredWithVariants.length === 1 ? '' : 's'}</span>
          )}
          <button
            type="button"
            onClick={clearColorSearch}
            className="rounded border border-violet-300 bg-white px-2.5 py-1 text-[0.6rem] hover:bg-violet-100"
          >
            Clear color search
          </button>
        </div>
      )}

      <div
        className={`overflow-hidden transition-[max-height,opacity,transform] duration-300 ease-in-out ${
          galleryControlsVisible
            ? 'mb-4 max-h-[2000px] opacity-100 translate-y-0'
            : 'mb-0 max-h-0 pointer-events-none opacity-0 -translate-y-2'
        }`}
        aria-hidden={!galleryControlsVisible}
        data-compact-mode={compactScrollMode ? 'true' : 'false'}
      >
        <div className="mb-4 rounded-lg border border-gray-100 bg-white p-4 shadow-sm">
          <LegacyTopBar
            filteredCount={filteredWithVariants.length}
            totalCount={images.length}
            namespaceLabel={namespaceLabel}
            namespace={namespace}
            showPagination={showPagination}
            currentPageRangeLabel={currentPageRangeLabel}
            sortedImages={sortedImages}
            dateFilter={dateFilter}
            onDateFilterChange={setDateFilter}
            bulkSelectionMode={bulkSelectionMode}
            filtersCollapsed={filtersCollapsed}
            hasActiveFilters={hasActiveFilters}
            pageSize={pageSize}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            defaultPageSize={DEFAULT_PAGE_SIZE}
            gridSize={gridSize}
            refreshingCache={refreshingCache}
            viewMode={viewMode}
            selectedCount={selectedCount}
            bulkEmbeddingGenerating={bulkEmbeddingGenerating}
            bulkDeleting={bulkDeleting}
            onToggleBulkSelection={() => setBulkSelectionMode(!bulkSelectionMode)}
            onToggleFilters={() => setFiltersCollapsed(prev => !prev)}
            onClearFilters={handleClearFilters}
            onPageSizeChange={handlePageSizeChange}
            onGridSizeChange={setGridSize}
            onRefreshCache={() => fetchImages({ forceRefresh: true })}
            onOpenNamespaceSettings={() => setNamespaceSettingsOpen(true)}
            onToggleViewMode={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
            onSelectPage={() => selectAllOnPage(pageImages)}
            onClearSelection={clearSelection}
            onOpenBulkEdit={openBulkEditModal}
            onGenerateEmbeddings={generateEmbeddingsForSelected}
            onDeleteSelected={deleteSelectedImages}
            backupControls={(
              <div className="ml-1 flex items-end gap-2 text-[0.6rem] font-mono text-gray-500">
                <div className="text-right leading-tight">
                  <div>Last backup: {backupTimeLabel}</div>
                  <div className="text-gray-400">{backupSizeLabel} • {backupAgeLabel}</div>
                  {backupError && <div className="text-red-500">{backupError}</div>}
                </div>
                <button
                  type="button"
                  onClick={handleCreateBackup}
                  disabled={backupLoading}
                  className="inline-flex h-7 w-7 items-center justify-center rounded border border-gray-200 bg-white/80 text-gray-600 hover:bg-white disabled:opacity-50"
                  title="Create backup"
                  aria-label="Create backup"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4" y="3" width="16" height="18" rx="2" />
                    <circle cx="12" cy="12" r="3" />
                    <path d="M12 9v6" />
                    <path d="M9 12h6" />
                    <path d="M7 7h2" />
                    <path d="M15 7h2" />
                  </svg>
                </button>
              </div>
            )}
          />
        </div>
        <div
          className={`transition-[max-height] duration-300 ease-in-out ${filtersCollapsed ? 'max-h-0 overflow-hidden' : 'max-h-[1200px] overflow-visible'}`}
          aria-hidden={filtersCollapsed}
        >
          <div
            id="gallery-filter-controls"
            className={`relative z-10 space-y-4 rounded-lg bg-gray-50 p-4 transition-opacity duration-300 ${filtersCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
          >
          <div className="grid grid-cols-1 gap-4 items-start">
            <div>
              <GalleryFilters
                searchTerm={searchTerm}
                onSearchChange={setSearchTerm}
                folders={visibleFolders}
                selectedFolder={selectedFolder}
                onFolderChange={setSelectedFolder}
                hiddenFolders={hiddenFolderSet}
                onToggleHiddenFolder={(folder: string) =>
                  hiddenFolderSet.has(folder) ? unhideFolderByName(folder) : hideFolderByName(folder)
                }
                onShowAllFolders={clearHiddenFolders}
                allTags={uniqueTags}
                selectedTag={selectedTag}
                onTagChange={setSelectedTag}
                hiddenTags={hiddenTagSet}
                onToggleHiddenTag={(tag: string) =>
                  hiddenTagSet.has(tag.toLowerCase()) ? unhideTagByName(tag) : hideTagByName(tag)
                }
                onShowAllTags={clearHiddenTags}
                aspectRatioFilters={aspectRatioFilters}
                onAspectRatioFiltersChange={setAspectRatioFilters}
                onlyCanonical={onlyCanonical}
                onOnlyCanonicalChange={setOnlyCanonical}
                respectAspectRatio={respectAspectRatio}
                onRespectAspectRatioChange={setRespectAspectRatio}
                showDuplicatesOnly={showDuplicatesOnly}
                onShowDuplicatesOnlyChange={setShowDuplicatesOnly}
                showVariationsOnly={onlyWithVariants}
                onShowVariationsOnlyChange={setOnlyWithVariants}
                showMotionAssetsOnly={showMotionAssetsOnly}
                onShowMotionAssetsOnlyChange={setShowMotionAssetsOnly}
                showComfyOnly={showComfyOnly}
                onShowComfyOnlyChange={setShowComfyOnly}
                showOnlyMissingEmbeddings={embeddingFilter !== 'none'}
                onShowOnlyMissingEmbeddingsChange={(value: boolean) =>
                  setEmbeddingFilter(value ? 'missing-any' : 'none')
                }
                showBrokenOnly={showBrokenOnly}
                onShowBrokenOnlyChange={setShowBrokenOnly}
                onClearFilters={handleClearFilters}
                hasActiveFilters={hasActiveFilters || Boolean(colorSearchHex)}
              />
            </div>

            <div className="sr-only" aria-hidden="true" />
          </div>

          {(auditLoading || auditEntries.length > 0) && (
            <div className="rounded-md border border-gray-200 bg-white p-3 text-[0.65rem] font-mono text-gray-700">
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
                      : '0%'
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
                    <span className="text-gray-500">
                      {entry.status ?? '—'} {entry.reason ?? ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {showCli && (
            <GalleryCommandBar
              hiddenFolders={hiddenFolders}
              hiddenTags={hiddenTags}
              knownFolders={uniqueFolders}
              knownTags={uniqueTags}
              onHideFolder={hideFolderByName}
              onUnhideFolder={unhideFolderByName}
              onClearHidden={clearHiddenFolders}
              onHideTag={hideTagByName}
              onUnhideTag={unhideTagByName}
              onClearHiddenTags={clearHiddenTags}
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
              onClose={() => setShowCli(false)}
            />
          )}
          </div>
        </div>
      </div>

      <div
        className="hidden sm:block fixed right-4 top-1/2 -translate-y-1/2 z-[3000]"
        onMouseEnter={() => setUtilityExpanded(true)}
        onMouseLeave={() => setUtilityExpanded(false)}
        onFocusCapture={() => setUtilityExpanded(true)}
        onBlurCapture={() => setUtilityExpanded(false)}
      >
        {utilityExpanded ? (
          <div className="pointer-events-auto flex flex-col gap-3 bg-gray-900 text-white border border-gray-700 rounded-2xl shadow-xl px-4 py-3 min-w-[220px]">
            <div className="flex items-center justify-between text-[0.6rem] uppercase tracking-wide text-gray-300">
              <span>Utility</span>
              <button
                onClick={() => setUtilityExpanded(false)}
                className="text-gray-400 hover:text-white"
                aria-label="Collapse utility bar"
              >
                ✕
              </button>
            </div>
            <button
              onClick={() => setFiltersCollapsed(prev => !prev)}
              className={`${utilityButtonClasses} text-left bg-white/10 hover:bg-white/20`}
              aria-pressed={!filtersCollapsed}
            >
              {filtersCollapsed ? 'Show filters' : 'Hide filters'}
            </button>
            <button
              onClick={() => setShowCli(prev => !prev)}
              className={`${utilityButtonClasses} text-left bg-white/10 hover:bg-white/20`}
              aria-pressed={showCli}
            >
              {showCli ? 'Hide CLI' : 'Show CLI'}
            </button>
            {videoResultsNotice && (
              <div className="flex flex-col gap-1 rounded-xl border border-sky-300/40 bg-sky-500/10 p-3 text-[0.6rem] text-sky-100">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-sky-400/20 px-2 py-0.5 uppercase tracking-wide text-sky-100">
                    Videos
                  </span>
                  <span>
                    {videoMeta ? `${videoMeta.returned}/${videoMeta.totalScoped || videoMeta.returned} shown` : 'Video results limited'}
                  </span>
                  {videoMeta?.limit ? <span className="text-sky-200/80">limit {videoMeta.limit}</span> : null}
                  <button
                    type="button"
                    className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-sky-300/50 bg-white/10 text-sky-100 hover:bg-white/20"
                    title={videoResultsNotice}
                    aria-label={videoResultsNotice}
                  >
                    <Info className="h-3 w-3" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={loadMoreVideos}
                  className={`${utilityButtonClasses} self-start border border-sky-300/50 bg-white/10 hover:bg-white/20`}
                >
                  Load more videos
                </button>
              </div>
            )}
            {selectedCount > 0 && (
              <div className="flex flex-col gap-1 text-[0.6rem] text-white">
                <span>{selectedCount} selected</span>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => selectAllOnPage(pageImages)}
                    className={`${utilityButtonClasses} border border-white/20`}
                  >
                    Select page
                  </button>
                  <button
                    onClick={openBulkEditModal}
                    className={`${utilityButtonClasses} bg-blue-600 hover:bg-blue-500`}
                  >
                    Bulk edit
                  </button>
                  <button
                    onClick={clearSelection}
                    className={`${utilityButtonClasses} border border-white/20`}
                  >
                    Clear
                  </button>
                </div>
              </div>
            )}
            <div className="flex flex-col gap-2 text-[0.6rem] text-gray-200">
              <button
                onClick={scrollGalleryToTop}
                className={`${utilityButtonClasses} text-left`}
              >
                Scroll top
              </button>
              <button
                onClick={scrollToUploader}
                className={`${utilityButtonClasses} text-left`}
              >
                Go to uploader
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setUtilityExpanded(true)}
            className="pointer-events-auto flex items-center gap-2 bg-gray-900/90 text-white border border-gray-700 rounded-full shadow-lg px-3 py-2 text-[0.65rem] font-mono uppercase tracking-wide hover:bg-gray-800"
            aria-label="Expand utility bar"
          >
            Utility
          </button>
        )}
      </div>

      {!hasResults ? (
        <div id="gallery-empty-state" className="text-center py-12">
          <div className="text-gray-400 mb-2">
            <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 20 20" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <p className="text-gray-500">
            {images.length === 0 ? 'No images uploaded yet' : 'No images match your filters'}
          </p>
          <p className="text-[0.7em] font-mono text-gray-400">
            {images.length === 0
              ? 'Upload some images to see them here'
              : colorSearchHex
                ? 'Try a different swatch or clear the active color search'
                : 'Try adjusting your search or filters'}
          </p>
          {images.length > 0 && (hasActiveFilters || Boolean(colorSearchHex)) && (
            <button
              onClick={handleClearFilters}
              className="mt-3 px-3 py-1 text-[0.7em] font-mono border border-gray-200 rounded-md hover:bg-gray-100 transition"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        viewMode === 'grid' ? (
          <GalleryGridView
            gridSize={gridSize}
            filters={viewFilters}
            onToggleSelection={toggleSelection}
            onBeforeNavigate={saveGalleryReturnState}
            onCopyNamespace={(ns) => { void copyToClipboard(ns, 'Namespace', toast.push); }}
            onSelectColor={handleSelectColor}
            onToggleCopyMenu={handleOpenCopyMenu}
            onStartEdit={startEdit}
            onDelete={deleteImage}
            onGenerateAlt={generateAltTag}
            onGenerateDisplayName={generateDisplayName}
            onMouseEnter={handleMouseEnter}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          />
        ) : (
          <GalleryListView
            filters={viewFilters}
            onToggleSelection={toggleSelection}
            onStartEdit={startEdit}
            onDelete={deleteImage}
            onGenerateAlt={generateAltTag}
            onGenerateDisplayName={generateDisplayName}
            onCopyUrl={handleOpenCopyMenu}
            onCopyNamespace={(ns) => { void copyToClipboard(ns, 'Namespace', toast.push); }}
            onSelectColor={handleSelectColor}
            onBeforeNavigate={saveGalleryReturnState}
            onDragStart={(event, img) => setDragPayloadForImage(event, img)}
            onMouseEnter={handleMouseEnter}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          />
        )
      )}

      <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex-1 min-w-[200px]">
          <label htmlFor="variant-select" className="block text-[0.7em] font-mono font-medum text-gray-700 mb-1">
            Image Size
          </label>
          <MonoSelect
            id="variant-select"
            value={selectedVariant}
            onChange={setSelectedVariant}
            options={variantOptions}
            className="w-full"
            size="sm"
          />
        </div>
        <FolderManagerButton
          onFoldersChanged={handleFoldersChanged}
          size="sm"
          label="Edit Folders"
          namespace={namespace}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-[0.65rem] font-mono text-gray-600">
        <button
          onClick={runBrokenAudit}
          disabled={auditLoading}
          className="inline-flex items-center gap-2 px-3 py-1 border border-gray-300 rounded-md bg-white hover:bg-gray-100 disabled:opacity-50"
        >
          <AlertTriangle className="h-3 w-3" />
          {auditLoading ? 'Auditing…' : 'Audit broken URLs'}
        </button>
        <span>
          Broken: {brokenAudit.ids.length}
        </span>
        {brokenAudit.checkedAt && (
          <span>
            Last audit: {new Date(brokenAudit.checkedAt).toLocaleString()}
          </span>
        )}
        {(auditLoading || auditProgress.checked > 0) && (
          <span>
            Checked: {auditProgress.checked}/{auditProgress.total}
          </span>
        )}
      </div>

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
