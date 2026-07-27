import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from './constants';
import { normalizeDateFilterValue } from './dateFilter';
import type { AspectRatioClass, DateFilter, EmbeddingFilter } from './types';

export const GALLERY_RETURN_STATE_KEY = 'galleryReturnStateV1';
export const GALLERY_RETURN_SNAPSHOT_KEY = 'galleryReturnSnapshotV1';
export const GALLERY_PAGE_SNAPSHOTS_KEY = 'galleryPageSnapshotsV2';
export const DETAIL_ASSET_SEED_KEY = 'detailAssetSeedV1';
export const GALLERY_RETURN_TTL_MS = 10 * 60 * 1000;
export const GALLERY_RETURN_STATE_VERSION = 2;
export const GALLERY_PAGE_SNAPSHOT_LIMIT = 8;

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
  showFavoritesOnly: boolean;
  showDuplicatesOnly: boolean;
  showBrokenOnly: boolean;
  showComfyOnly: boolean;
  embeddingFilter: EmbeddingFilter;
  aspectRatioFilters: AspectRatioClass[];
  dateFilter: DateFilter | null;
  hiddenFolders: string[];
  hiddenTags: string[];
  hiddenNamespaces: string[];
  pageSize: number;
  currentPage: number;
};

export type GalleryPageSnapshot<TAsset extends { id: string } = { id: string }> = {
  namespace: string;
  page: number;
  filterSignature: string;
  catalogVersion: number | null;
  savedAt: number;
  images: TAsset[];
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

type DetailAssetSeedState = {
  savedAt?: number;
  namespace?: string;
  asset?: unknown;
};

export type DetailAssetSeed<TAsset extends { id: string } = { id: string }> = {
  savedAt: number;
  namespace: string;
  asset: TAsset;
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
    showFavoritesOnly: Boolean(raw.showFavoritesOnly),
    showDuplicatesOnly: Boolean(raw.showDuplicatesOnly),
    showBrokenOnly: Boolean(raw.showBrokenOnly),
    showComfyOnly: Boolean(raw.showComfyOnly),
    embeddingFilter: normalizeEmbeddingFilter(raw.embeddingFilter),
    aspectRatioFilters: normalizeAspectRatioFilters(raw.aspectRatioFilters),
    dateFilter: normalizeDateFilterValue(raw.dateFilter),
    hiddenFolders: normalizeStringArray(raw.hiddenFolders),
    hiddenTags: normalizeStringArray(raw.hiddenTags),
    hiddenNamespaces: normalizeStringArray(raw.hiddenNamespaces),
    pageSize: normalizePageSize(raw.pageSize),
    currentPage: normalizePositiveInteger(raw.currentPage, 1),
  };
};

type GallerySnapshotFilterInput = {
  pageSize?: number;
  search?: string;
  folder?: string;
  tag?: string;
  onlyCanonical?: boolean;
  onlyWithVariants?: boolean;
  favorites?: boolean;
  duplicates?: boolean;
  comfy?: boolean;
  embedding?: string;
  aspectRatioFilters?: string[];
  dateFilter?: unknown;
  hiddenFolders?: string[];
  hiddenTags?: string[];
  hiddenNamespaces?: string[];
  showMotionAssetsOnly?: boolean;
};

export const createGallerySnapshotFilterSignature = (
  input: GallerySnapshotFilterInput
): string => JSON.stringify({
  pageSize: normalizePageSize(input.pageSize),
  search: input.search?.trim() ?? '',
  folder: input.folder?.trim() || 'all',
  tag: input.tag?.trim() ?? '',
  onlyCanonical: Boolean(input.onlyCanonical),
  onlyWithVariants: Boolean(input.onlyWithVariants),
  favorites: Boolean(input.favorites),
  duplicates: Boolean(input.duplicates),
  comfy: Boolean(input.comfy),
  embedding: input.embedding ?? 'none',
  aspectRatioFilters: normalizeStringArray(input.aspectRatioFilters).sort(),
  dateFilter: normalizeDateFilterValue(input.dateFilter),
  hiddenFolders: normalizeStringArray(input.hiddenFolders).sort(),
  hiddenTags: normalizeStringArray(input.hiddenTags).sort(),
  hiddenNamespaces: normalizeStringArray(input.hiddenNamespaces).sort(),
  showMotionAssetsOnly: Boolean(input.showMotionAssetsOnly),
});

export const createGalleryReturnFilterSignature = (
  filters: GalleryReturnFilters
): string => createGallerySnapshotFilterSignature({
  pageSize: filters.pageSize,
  search: filters.searchTerm,
  folder: filters.selectedFolder,
  tag: filters.selectedTag,
  onlyCanonical: filters.onlyCanonical,
  onlyWithVariants: filters.onlyWithVariants,
  favorites: filters.showFavoritesOnly,
  duplicates: filters.showDuplicatesOnly,
  comfy: filters.showComfyOnly,
  embedding: filters.embeddingFilter,
  aspectRatioFilters: filters.aspectRatioFilters,
  dateFilter: filters.dateFilter,
  hiddenFolders: filters.hiddenFolders,
  hiddenTags: filters.hiddenTags,
  hiddenNamespaces: filters.hiddenNamespaces,
  showMotionAssetsOnly: filters.showMotionAssetsOnly,
});

const readGalleryPageSnapshots = <TAsset extends { id: string }>(): GalleryPageSnapshot<TAsset>[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.sessionStorage.getItem(GALLERY_PAGE_SNAPSHOTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry): GalleryPageSnapshot<TAsset>[] => {
      if (!entry || typeof entry !== 'object') return [];
      const candidate = entry as Partial<GalleryPageSnapshot<TAsset>>;
      if (
        typeof candidate.namespace !== 'string'
        || typeof candidate.page !== 'number'
        || typeof candidate.filterSignature !== 'string'
        || typeof candidate.savedAt !== 'number'
        || !Array.isArray(candidate.images)
      ) {
        return [];
      }
      const images = candidate.images.filter(
        (image): image is TAsset =>
          Boolean(image) && typeof image === 'object' && typeof image.id === 'string'
      );
      return [{
        namespace: candidate.namespace,
        page: Math.max(1, Math.floor(candidate.page)),
        filterSignature: candidate.filterSignature,
        catalogVersion:
          typeof candidate.catalogVersion === 'number' ? candidate.catalogVersion : null,
        savedAt: candidate.savedAt,
        images,
      }];
    }).filter((entry) => Date.now() - entry.savedAt < GALLERY_RETURN_TTL_MS);
  } catch {
    return [];
  }
};

const galleryPageSnapshotKey = (
  snapshot: Pick<GalleryPageSnapshot, 'namespace' | 'page' | 'filterSignature'>
) => `${snapshot.namespace}\u0000${snapshot.page}\u0000${snapshot.filterSignature}`;

export const saveGalleryPageSnapshot = <TAsset extends { id: string }>(
  snapshot: GalleryPageSnapshot<TAsset>
): void => {
  if (typeof window === 'undefined' || snapshot.images.length === 0) return;
  try {
    const key = galleryPageSnapshotKey(snapshot);
    const entries = readGalleryPageSnapshots<TAsset>()
      .filter((entry) => galleryPageSnapshotKey(entry) !== key);
    entries.unshift(snapshot);
    window.sessionStorage.setItem(
      GALLERY_PAGE_SNAPSHOTS_KEY,
      JSON.stringify(entries.slice(0, GALLERY_PAGE_SNAPSHOT_LIMIT))
    );
  } catch {
    // Session storage is an optional paint optimization.
  }
};

export const getFreshGalleryPageSnapshot = <TAsset extends { id: string }>(options: {
  namespace: string;
  page?: number;
  filterSignature?: string;
  assetId?: string;
}): GalleryPageSnapshot<TAsset> | null => {
  const snapshots = readGalleryPageSnapshots<TAsset>();
  return snapshots.find((snapshot) => {
    if (snapshot.namespace !== options.namespace) return false;
    if (options.page !== undefined && snapshot.page !== options.page) return false;
    if (
      options.filterSignature !== undefined
      && snapshot.filterSignature !== options.filterSignature
    ) {
      return false;
    }
    if (options.assetId && !snapshot.images.some((image) => image.id === options.assetId)) {
      return false;
    }
    return true;
  }) ?? null;
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

export const clearGalleryReturnSnapshot = (): void => {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(GALLERY_RETURN_SNAPSHOT_KEY);
};

const isSeedAssetRecord = (value: unknown): value is Record<string, unknown> & { id: string } => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string' && record.id.length > 0;
};

const parseRawDetailAssetSeed = (): DetailAssetSeedState | null => {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.sessionStorage.getItem(DETAIL_ASSET_SEED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as DetailAssetSeedState;
  } catch {
    return null;
  }
};

export const saveDetailAssetSeed = <TAsset extends { id: string; assetType?: AssetType }>(
  asset: TAsset,
  namespace: string,
  savedAt = Date.now()
): void => {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(
    DETAIL_ASSET_SEED_KEY,
    JSON.stringify({
      savedAt,
      namespace,
      asset,
    } satisfies DetailAssetSeedState)
  );
};

export const getFreshDetailAssetSeed = <TAsset extends { id: string } = { id: string }>(options: {
  id?: string | null;
  assetType?: AssetType;
  namespace?: string;
  now?: number;
}): DetailAssetSeed<TAsset> | null => {
  const parsed = parseRawDetailAssetSeed();
  if (!parsed) return null;

  const savedAt = typeof parsed.savedAt === 'number' ? parsed.savedAt : 0;
  const now = options.now ?? Date.now();
  const freshEnough = !savedAt || now - savedAt < GALLERY_RETURN_TTL_MS;
  if (!freshEnough) return null;

  const namespace = typeof parsed.namespace === 'string' ? parsed.namespace : '';
  if (typeof options.namespace === 'string' && namespace !== options.namespace) {
    return null;
  }

  if (!isSeedAssetRecord(parsed.asset)) return null;
  if (options.id && parsed.asset.id !== options.id) return null;
  if (options.assetType) {
    const actualType = parsed.asset.assetType === 'video' ? 'video' : 'image';
    if (actualType !== options.assetType) return null;
  }

  return {
    savedAt,
    namespace,
    asset: parsed.asset as TAsset,
  };
};

export const clearDetailAssetSeed = (): void => {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(DETAIL_ASSET_SEED_KEY);
};
