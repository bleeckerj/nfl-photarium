import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from './constants';
import { normalizeDateFilterValue } from './dateFilter';
import type { AspectRatioClass, DateFilter, EmbeddingFilter } from './types';

export const GALLERY_RETURN_STATE_KEY = 'galleryReturnStateV1';
export const GALLERY_RETURN_SNAPSHOT_KEY = 'galleryReturnSnapshotV1';
export const GALLERY_RETURN_TTL_MS = 10 * 60 * 1000;
export const GALLERY_RETURN_STATE_VERSION = 2;

type AssetType = 'image' | 'video';

export type GalleryReturnResultAsset = {
  id: string;
  assetType?: AssetType;
};

export type GalleryReturnFilters = {
  searchTerm: string;
  colorSearchHex?: string | null;
  selectedFolder: string;
  selectedTag: string;
  onlyCanonical: boolean;
  onlyWithVariants: boolean;
  showMotionAssetsOnly: boolean;
  showDuplicatesOnly: boolean;
  showBrokenOnly: boolean;
  showComfyOnly: boolean;
  embeddingFilter: EmbeddingFilter;
  aspectRatioFilters: AspectRatioClass[];
  dateFilter: DateFilter | null;
  hiddenFolders: string[];
  hiddenTags: string[];
  pageSize: number;
  currentPage: number;
};

type GalleryReturnStateV2 = {
  version: 2;
  namespace?: string;
  savedAt?: number;
  currentPage?: number;
  scrollY?: number;
  selectedImageId?: string;
  resultIds?: string[];
  resultAssets?: GalleryReturnResultAsset[];
  filters?: Partial<GalleryReturnFilters>;
};

type GalleryReturnStateLegacy = {
  version?: number;
  namespace?: string;
  savedAt?: number;
  currentPage?: number;
  scrollY?: number;
  selectedImageId?: string;
  resultIds?: string[];
  resultAssets?: GalleryReturnResultAsset[];
};

export type NormalizedGalleryReturnState = {
  version: 1 | 2;
  namespace: string;
  savedAt: number;
  scrollY: number;
  selectedImageId: string | null;
  resultIds: string[];
  resultAssets: GalleryReturnResultAsset[];
  currentPage: number;
  filters: GalleryReturnFilters | null;
};

const EMBEDDING_FILTERS = new Set<EmbeddingFilter>([
  'none',
  'missing-clip',
  'missing-color',
  'missing-any',
  'missing-both',
]);

const ASPECT_RATIO_FILTERS = new Set<AspectRatioClass>(['horizontal', 'vertical', 'square']);

const normalizePositiveInteger = (value: unknown, fallback: number) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
};

const normalizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const normalizeResultAssets = (value: unknown): GalleryReturnResultAsset[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const raw = entry as { id?: unknown; assetType?: unknown };
    if (typeof raw.id !== 'string' || raw.id.length === 0) return [];
    return [
      {
        id: raw.id,
        assetType: raw.assetType === 'video' ? 'video' : 'image',
      },
    ];
  });
};

const normalizeEmbeddingFilter = (value: unknown): EmbeddingFilter =>
  typeof value === 'string' && EMBEDDING_FILTERS.has(value as EmbeddingFilter)
    ? (value as EmbeddingFilter)
    : 'none';

const normalizeAspectRatioFilters = (value: unknown): AspectRatioClass[] => {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is AspectRatioClass =>
      typeof entry === 'string' && ASPECT_RATIO_FILTERS.has(entry as AspectRatioClass)
  );
};

const normalizePageSize = (value: unknown) => {
  const pageSize = normalizePositiveInteger(value, DEFAULT_PAGE_SIZE);
  return PAGE_SIZE_OPTIONS.includes(pageSize) ? pageSize : DEFAULT_PAGE_SIZE;
};

const normalizeFilters = (value: unknown): GalleryReturnFilters | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const raw = value as Record<string, unknown>;
  return {
    searchTerm: typeof raw.searchTerm === 'string' ? raw.searchTerm : '',
    colorSearchHex:
      typeof raw.colorSearchHex === 'string' && raw.colorSearchHex.trim()
        ? raw.colorSearchHex.trim()
        : null,
    selectedFolder: typeof raw.selectedFolder === 'string' ? raw.selectedFolder : 'all',
    selectedTag: typeof raw.selectedTag === 'string' ? raw.selectedTag : '',
    onlyCanonical: Boolean(raw.onlyCanonical),
    onlyWithVariants: Boolean(raw.onlyWithVariants),
    showMotionAssetsOnly: Boolean(raw.showMotionAssetsOnly),
    showDuplicatesOnly: Boolean(raw.showDuplicatesOnly),
    showBrokenOnly: Boolean(raw.showBrokenOnly),
    showComfyOnly: Boolean(raw.showComfyOnly),
    embeddingFilter: normalizeEmbeddingFilter(raw.embeddingFilter),
    aspectRatioFilters: normalizeAspectRatioFilters(raw.aspectRatioFilters),
    dateFilter: normalizeDateFilterValue(raw.dateFilter),
    hiddenFolders: normalizeStringArray(raw.hiddenFolders),
    hiddenTags: normalizeStringArray(raw.hiddenTags),
    pageSize: normalizePageSize(raw.pageSize),
    currentPage: normalizePositiveInteger(raw.currentPage, 1),
  };
};

const parseRawGalleryReturnState = (): GalleryReturnStateLegacy | GalleryReturnStateV2 | null => {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.sessionStorage.getItem(GALLERY_RETURN_STATE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as GalleryReturnStateLegacy | GalleryReturnStateV2;
  } catch {
    return null;
  }
};

export const getFreshGalleryReturnState = (
  expectedNamespace?: string
): NormalizedGalleryReturnState | null => {
  const parsed = parseRawGalleryReturnState();
  if (!parsed) return null;

  const savedAt = typeof parsed.savedAt === 'number' ? parsed.savedAt : 0;
  const freshEnough = !savedAt || Date.now() - savedAt < GALLERY_RETURN_TTL_MS;
  const namespace = typeof parsed.namespace === 'string' ? parsed.namespace : '';

  if (!freshEnough) return null;
  if (typeof expectedNamespace === 'string' && namespace !== expectedNamespace) {
    return null;
  }

  const version = parsed.version === GALLERY_RETURN_STATE_VERSION ? 2 : 1;
  const filters = version === 2 ? normalizeFilters((parsed as GalleryReturnStateV2).filters) : null;
  const currentPage = filters?.currentPage ?? normalizePositiveInteger(parsed.currentPage, 1);

  return {
    version,
    namespace,
    savedAt,
    scrollY: typeof parsed.scrollY === 'number' && Number.isFinite(parsed.scrollY) ? parsed.scrollY : 0,
    selectedImageId:
      typeof parsed.selectedImageId === 'string' && parsed.selectedImageId.length > 0
        ? parsed.selectedImageId
        : null,
    resultIds: normalizeStringArray(parsed.resultIds),
    resultAssets: normalizeResultAssets(parsed.resultAssets),
    currentPage,
    filters,
  };
};

export const hasFreshGalleryReturnState = (expectedNamespace?: string): boolean =>
  Boolean(getFreshGalleryReturnState(expectedNamespace));

export const saveGalleryReturnState = (
  value: Omit<GalleryReturnStateV2, 'version'>
): void => {
  if (typeof window === 'undefined') return;

  window.sessionStorage.setItem(
    GALLERY_RETURN_STATE_KEY,
    JSON.stringify({
      version: GALLERY_RETURN_STATE_VERSION,
      ...value,
    } satisfies GalleryReturnStateV2)
  );
};

export const clearGalleryReturnState = (): void => {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(GALLERY_RETURN_STATE_KEY);
};
