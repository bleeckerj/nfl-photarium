import {
  DEFAULT_GALLERY_VARIANT,
  DEFAULT_GRID_SIZE,
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
} from './constants';
import { normalizeDateFilterValue } from './dateFilter';
import { normalizeColorSearchHex } from './colorSearch';
import { normalizeGridSize } from './gridSizing';
import { loadHiddenFolders, loadHiddenNamespaces, loadHiddenTags } from './storage';
import type { AspectRatioClass, DateFilter, EmbeddingFilter, GridSize } from './types';
import type { NormalizedGalleryReturnState } from './returnState';

export { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from './constants';

export type StoredGalleryPreferences = {
  variant: string;
  onlyCanonical: boolean;
  respectAspectRatio: boolean;
  onlyWithVariants: boolean;
  showMotionAssetsOnly: boolean;
  showFavoritesOnly: boolean;
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
  aspectRatioFilters: AspectRatioClass[];
  hiddenFolders: string[];
  hiddenTags: string[];
  hiddenNamespaces?: string[];
  showCli: boolean;
  controlsVisible: boolean;
  pageSize: number;
  dateFilter: DateFilter | null;
  currentPage: number;
};

export const getDefaultStoredPreferences = (): StoredGalleryPreferences => ({
  variant: DEFAULT_GALLERY_VARIANT,
  onlyCanonical: false,
  respectAspectRatio: false,
  onlyWithVariants: false,
  showMotionAssetsOnly: false,
  showFavoritesOnly: false,
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
  initialGalleryReturnState: NormalizedGalleryReturnState | null,
  options: { neutralizeFilters?: boolean } = {}
): StoredGalleryPreferences => {
  if (typeof window === 'undefined') {
    return getDefaultStoredPreferences();
  }

  const next = getDefaultStoredPreferences();
  // Hidden visibility rules live in dedicated storage keys so they can be
  // persisted independently from the general preference blob. Hydrate them
  // before initial gallery state is created so a browser restart preserves
  // the same visibility rules.
  next.hiddenFolders = loadHiddenFolders();
  next.hiddenTags = loadHiddenTags();
  next.hiddenNamespaces = loadHiddenNamespaces();

  try {
    const stored = window.localStorage.getItem('galleryPreferences');
    if (stored) {
      const parsed = JSON.parse(stored) as {
        prefsVersion?: number;
        variant?: string;
        onlyCanonical?: boolean;
        respectAspectRatio?: boolean;
        onlyWithVariants?: boolean;
        showMotionAssetsOnly?: boolean;
        showFavoritesOnly?: boolean;
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
        aspectRatioFilters?: AspectRatioClass[];
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
      const storedVariant = typeof parsed.variant === 'string' ? parsed.variant : DEFAULT_GALLERY_VARIANT;
      const normalizedVariant =
        storedVariant === 'public' || storedVariant === 'original' ? 'full' : storedVariant;
      const storedPrefsVersion = typeof parsed.prefsVersion === 'number' ? parsed.prefsVersion : 1;

      // v1 blobs carried 'full' as the inherited default; migrate them to the
      // thumbnail default. A Full chosen after v2 was stamped is kept.
      next.variant =
        storedPrefsVersion < 2 && normalizedVariant === 'full'
          ? DEFAULT_GALLERY_VARIANT
          : normalizedVariant;
      next.onlyCanonical = Boolean(parsed.onlyCanonical);
      next.respectAspectRatio = Boolean(parsed.respectAspectRatio);
      next.onlyWithVariants = Boolean(parsed.onlyWithVariants);
      next.showMotionAssetsOnly = Boolean(parsed.showMotionAssetsOnly);
      next.showFavoritesOnly = Boolean(parsed.showFavoritesOnly);
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

  if (options.neutralizeFilters) {
    return neutralizeStoredPreferenceFilters(next);
  }

  if (initialGalleryReturnState?.filters) {
    next.searchTerm = initialGalleryReturnState.filters.searchTerm;
    next.colorSearchHex = initialGalleryReturnState.filters.colorSearchHex ?? null;
    next.selectedFolder = initialGalleryReturnState.filters.selectedFolder;
    next.selectedTag = initialGalleryReturnState.filters.selectedTag;
    next.onlyCanonical = initialGalleryReturnState.filters.onlyCanonical;
    next.onlyWithVariants = initialGalleryReturnState.filters.onlyWithVariants;
    next.showMotionAssetsOnly = initialGalleryReturnState.filters.showMotionAssetsOnly;
    next.showFavoritesOnly = Boolean(initialGalleryReturnState.filters.showFavoritesOnly);
    next.showDuplicatesOnly = initialGalleryReturnState.filters.showDuplicatesOnly;
    next.showBrokenOnly = initialGalleryReturnState.filters.showBrokenOnly;
    next.showComfyOnly = initialGalleryReturnState.filters.showComfyOnly;
    next.embeddingFilter = initialGalleryReturnState.filters.embeddingFilter;
    next.aspectRatioFilters = initialGalleryReturnState.filters.aspectRatioFilters;
    next.dateFilter = initialGalleryReturnState.filters.dateFilter;
    next.hiddenFolders = initialGalleryReturnState.filters.hiddenFolders;
    next.hiddenTags = initialGalleryReturnState.filters.hiddenTags;
    next.hiddenNamespaces = initialGalleryReturnState.filters.hiddenNamespaces;
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
    // Ignore malformed gallery return query state.
  }

  return next;
};

export const neutralizeStoredPreferenceFilters = (
  preferences: StoredGalleryPreferences
): StoredGalleryPreferences => ({
  ...preferences,
  searchTerm: '',
  colorSearchHex: null,
  selectedFolder: 'all',
  selectedTag: '',
  onlyCanonical: false,
  onlyWithVariants: false,
  showMotionAssetsOnly: false,
  showFavoritesOnly: false,
  showComfyOnly: false,
  showDuplicatesOnly: false,
  showBrokenOnly: false,
  embeddingFilter: 'none',
  aspectRatioFilters: [],
  hiddenFolders: [],
  hiddenTags: [],
  hiddenNamespaces: [],
  dateFilter: null,
  currentPage: 1,
});
