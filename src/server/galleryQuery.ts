import { getUserVisibleTags, hasFavoriteTag } from '@/utils/systemTags';
import { computeDuplicateGroups, buildFamilySummaryMap } from '@/components/gallery/utils';

export type GalleryQueryAsset = {
  id: string;
  assetType?: 'image' | 'video';
  filename?: string;
  displayName?: string;
  uploaded?: string;
  variants?: string[];
  folder?: string;
  tags?: string[];
  description?: string;
  altTag?: string;
  altText?: string;
  promptThis?: string;
  parentId?: string;
  originalUrl?: string;
  originalUrlNormalized?: string;
  sourceUrl?: string;
  sourceUrlNormalized?: string;
  contentHash?: string;
  namespace?: string;
  generatedBy?: string;
  comfyMetadataDetected?: boolean;
  comfyMetadataSource?: string;
  hasClipEmbedding?: boolean;
  hasColorEmbedding?: boolean;
  aspectRatio?: string;
  dimensions?: { width: number; height: number };
};

export type GalleryQueryFilters = {
  search?: string;
  folder?: string;
  tag?: string;
  onlyCanonical?: boolean;
  onlyWithVariants?: boolean;
  favorites?: boolean;
  duplicates?: boolean;
  comfy?: boolean;
  embedding?: 'none' | 'missing-clip' | 'missing-color' | 'missing-any' | 'missing-both';
  aspectRatioClasses?: Array<'horizontal' | 'vertical' | 'square'>;
  dateStart?: string;
  dateEnd?: string;
  hiddenFolders?: string[];
  hiddenTags?: string[];
};

export type GalleryQueryFacets = {
  folders: Array<{ value: string; count: number }>;
  tags: Array<{ value: string; count: number }>;
};

export type GalleryQueryResult<T extends GalleryQueryAsset> = {
  images: T[];
  scopeTotal: number;
  total: number;
  totalPages: number;
  page: number;
  pageSize: number;
  focus: GalleryQueryFocusResult | null;
  facets: GalleryQueryFacets;
  familySummaryMap: ReturnType<typeof buildFamilySummaryMap>;
  duplicateSummary: {
    groupCount: number;
    imageCount: number;
    pageDuplicateIds: string[];
    allDuplicateIds: string[];
    duplicateIdsExcludingNewest: string[];
    duplicateIdsExcludingOldest: string[];
  };
};

export type GalleryQueryFocusResult = {
  assetId: string;
  found: boolean;
  index: number;
  ordinal: number;
  page: number;
  pageSize: number;
  total: number;
};

const normalize = (value?: string) => value?.toLowerCase() ?? '';
const stripQuery = (value: string) => value.split('?')[0];

const splitCamelCase = (value?: string) =>
  (value ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');

const matchesSearch = (asset: GalleryQueryAsset, search?: string) => {
  const normalizedSearch = normalize(search?.trim());
  const normalizedSearchNoQuery = normalizedSearch ? stripQuery(normalizedSearch) : '';
  if (!normalizedSearch) return true;

  const baseHaystacks = [
    normalize(asset.id),
    normalize(asset.filename),
    normalize(asset.displayName),
    normalize(splitCamelCase(asset.displayName)),
    normalize(asset.promptThis),
    normalize(asset.folder),
    normalize(asset.altTag),
    normalize(asset.altText),
    normalize(asset.description),
    normalize(asset.originalUrl),
    normalize(asset.originalUrlNormalized),
    normalize(asset.sourceUrl),
    normalize(asset.sourceUrlNormalized),
    ...(asset.tags?.map(normalize) ?? []),
    ...(asset.variants?.map(normalize) ?? []),
  ].filter(Boolean);

  const haystacks = new Set<string>();
  baseHaystacks.forEach((value) => {
    haystacks.add(value);
    haystacks.add(stripQuery(value));
  });

  return Array.from(haystacks).some(
    (candidate) =>
      candidate.includes(normalizedSearch) ||
      (Boolean(normalizedSearchNoQuery) && candidate.includes(normalizedSearchNoQuery))
  );
};

const matchesFolder = (asset: GalleryQueryAsset, folder?: string) => {
  if (!folder || folder === 'all') return true;
  if (folder === 'no-folder') return !asset.folder;
  return asset.folder === folder;
};

const matchesTag = (asset: GalleryQueryAsset, tag?: string) => {
  if (!tag) return true;
  return Array.isArray(asset.tags) && asset.tags.includes(tag);
};

const matchesHidden = (asset: GalleryQueryAsset, hiddenFolders?: string[], hiddenTags?: string[]) => {
  if (hiddenFolders?.length) {
    const hiddenNoFolder = hiddenFolders.some((folder) => normalize(folder).replace(/\s+/g, '-') === 'no-folder');
    if (!asset.folder && hiddenNoFolder) return false;
    if (asset.folder && hiddenFolders.includes(asset.folder)) return false;
  }
  if (hiddenTags?.length && Array.isArray(asset.tags)) {
    const hiddenSet = new Set(hiddenTags.map(normalize));
    if (asset.tags.some((tag) => hiddenSet.has(normalize(tag)))) return false;
  }
  return true;
};

const matchesEmbedding = (asset: GalleryQueryAsset, embedding: GalleryQueryFilters['embedding']) => {
  if (!embedding || embedding === 'none') return true;
  if (embedding === 'missing-clip') return !asset.hasClipEmbedding;
  if (embedding === 'missing-color') return !asset.hasColorEmbedding;
  if (embedding === 'missing-both') return !asset.hasClipEmbedding && !asset.hasColorEmbedding;
  return !asset.hasClipEmbedding || !asset.hasColorEmbedding;
};

const matchesAspect = (asset: GalleryQueryAsset, classes?: GalleryQueryFilters['aspectRatioClasses']) => {
  if (!classes?.length) return true;
  if (asset.assetType === 'video') return true;
  if (!asset.dimensions?.width || !asset.dimensions?.height) return false;
  const ratio = asset.dimensions.width / asset.dimensions.height;
  const isSquare = Math.abs(ratio - 1) <= 0.05;
  const isHorizontal = ratio > 1.05;
  const isVertical = ratio < 0.95;
  return (
    (classes.includes('square') && isSquare) ||
    (classes.includes('horizontal') && isHorizontal) ||
    (classes.includes('vertical') && isVertical)
  );
};

const matchesDate = (asset: GalleryQueryAsset, dateStart?: string, dateEnd?: string) => {
  if (!dateStart && !dateEnd) return true;
  const uploadedMs = Date.parse(asset.uploaded ?? '');
  if (!Number.isFinite(uploadedMs)) return false;
  const startMs = dateStart ? Date.parse(`${dateStart}T00:00:00.000Z`) : -Infinity;
  const endMs = dateEnd ? Date.parse(`${dateEnd}T23:59:59.999Z`) : Infinity;
  return uploadedMs >= startMs && uploadedMs <= endMs;
};

const matchesComfy = (asset: GalleryQueryAsset) => {
  const generatedBy = typeof asset.generatedBy === 'string' ? asset.generatedBy.toLowerCase() : '';
  return generatedBy === 'comfyui' || asset.comfyMetadataDetected === true || Boolean(asset.comfyMetadataSource);
};

const buildFacets = <T extends GalleryQueryAsset>(assets: T[]): GalleryQueryFacets => {
  const folders = new Map<string, number>();
  const tags = new Map<string, number>();
  assets.forEach((asset) => {
    const folder = asset.folder?.trim();
    if (folder) folders.set(folder, (folders.get(folder) ?? 0) + 1);
    getUserVisibleTags(asset.tags).forEach((tag) => {
      tags.set(tag, (tags.get(tag) ?? 0) + 1);
    });
  });
  const sortEntries = (entries: Map<string, number>) =>
    Array.from(entries.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => a.value.localeCompare(b.value, undefined, { numeric: true, sensitivity: 'base' }));
  return {
    folders: sortEntries(folders),
    tags: sortEntries(tags),
  };
};

// -- Scope-level memoization ------------------------------------------------
// `buildFamilySummaryMap`, `matchesHidden` filtering, and `buildFacets` all
// produce results that depend only on (a) the asset array contents and (b)
// the hidden-folders/hidden-tags filters. They do NOT depend on per-request
// filters like search, folder, tag, page, etc. When a caller passes a stable
// `scopeKey` describing the snapshot of asset contents + hidden filters,
// we can compute these once and reuse them across every paginated request
// against the same scope.
//
// The cache is process-global (kept via Symbol.for so it survives HMR in dev)
// and bounded to a small number of entries with FIFO eviction. The expected
// working set is tiny (one entry per distinct namespace/scope combination).
interface ScopeMemoEntry {
  familySummaryMapAll: ReturnType<typeof buildFamilySummaryMap>;
  facetBase: GalleryQueryAsset[];
  facets: GalleryQueryFacets;
}

const SCOPE_MEMO_MAX_ENTRIES = 8;
const SCOPE_MEMO_CACHE_KEY = Symbol.for('photarium.galleryQuery.scopeMemo');
const scopeMemoGlobal = globalThis as typeof globalThis & {
  [SCOPE_MEMO_CACHE_KEY]?: Map<string, ScopeMemoEntry>;
};
const scopeMemoCache: Map<string, ScopeMemoEntry> =
  scopeMemoGlobal[SCOPE_MEMO_CACHE_KEY] ?? new Map();
if (!scopeMemoGlobal[SCOPE_MEMO_CACHE_KEY]) {
  scopeMemoGlobal[SCOPE_MEMO_CACHE_KEY] = scopeMemoCache;
}

const getOrBuildScopeMemo = <T extends GalleryQueryAsset>(
  cacheKey: string,
  assets: T[],
  filters: GalleryQueryFilters
): ScopeMemoEntry => {
  const cached = scopeMemoCache.get(cacheKey);
  if (cached) {
    // LRU touch: re-insert so it moves to the tail.
    scopeMemoCache.delete(cacheKey);
    scopeMemoCache.set(cacheKey, cached);
    return cached;
  }
  const familySummaryMapAll = buildFamilySummaryMap(assets as never);
  const facetBase = assets.filter((asset) =>
    matchesHidden(asset, filters.hiddenFolders, filters.hiddenTags)
  );
  const facets = buildFacets(facetBase);
  const entry: ScopeMemoEntry = {
    familySummaryMapAll,
    facetBase: facetBase as unknown as GalleryQueryAsset[],
    facets,
  };
  if (scopeMemoCache.size >= SCOPE_MEMO_MAX_ENTRIES) {
    const oldest = scopeMemoCache.keys().next().value;
    if (oldest !== undefined) scopeMemoCache.delete(oldest);
  }
  scopeMemoCache.set(cacheKey, entry);
  return entry;
};

export const clearGalleryQueryScopeMemo = () => {
  scopeMemoCache.clear();
};

const buildScopeMemoKey = (
  scopeKey: string,
  filters: GalleryQueryFilters
): string => {
  const hiddenFolders = (filters.hiddenFolders ?? []).slice().sort().join(',');
  const hiddenTags = (filters.hiddenTags ?? []).slice().sort().join(',');
  return `${scopeKey}|hf:${hiddenFolders}|ht:${hiddenTags}`;
};

export const queryGalleryAssets = <T extends GalleryQueryAsset>(
  assets: T[],
  filters: GalleryQueryFilters,
  page: number,
  pageSize: number,
  focusAssetId?: string,
  scopeKey?: string
): GalleryQueryResult<T> => {
  const scopeTotal = assets.length;
  // If the caller supplied a scopeKey, use the memoized family/facet artifacts
  // for this scope. Otherwise compute them inline (legacy / test path).
  let familySummaryMapAll: ReturnType<typeof buildFamilySummaryMap>;
  let facetBase: T[];
  let facets: GalleryQueryFacets;
  if (scopeKey) {
    const memo = getOrBuildScopeMemo(buildScopeMemoKey(scopeKey, filters), assets, filters);
    familySummaryMapAll = memo.familySummaryMapAll;
    facetBase = memo.facetBase as unknown as T[];
    facets = memo.facets;
  } else {
    familySummaryMapAll = buildFamilySummaryMap(assets as never);
    facetBase = assets.filter((asset) =>
      matchesHidden(asset, filters.hiddenFolders, filters.hiddenTags)
    );
    facets = buildFacets(facetBase);
  }

  const baseFiltered = facetBase.filter((asset) => {
    if (!matchesFolder(asset, filters.folder)) return false;
    if (!matchesTag(asset, filters.tag)) return false;
    if (filters.favorites && !hasFavoriteTag(asset.tags)) return false;
    if (!matchesSearch(asset, filters.search)) return false;
    if (filters.onlyCanonical && asset.parentId) return false;
    if (filters.comfy && !matchesComfy(asset)) return false;
    if (!matchesEmbedding(asset, filters.embedding)) return false;
    if (!matchesAspect(asset, filters.aspectRatioClasses)) return false;
    if (!matchesDate(asset, filters.dateStart, filters.dateEnd)) return false;
    if (filters.onlyWithVariants) {
      const summary = familySummaryMapAll[asset.id];
      if (summary?.isVariant || (summary?.variantCount ?? 0) === 0) return false;
    }
    return true;
  });

  const duplicateGroups = computeDuplicateGroups(baseFiltered as never);
  const duplicateIds = new Set<string>();
  duplicateGroups.forEach((group) => group.items.forEach((asset) => duplicateIds.add(asset.id)));
  const selectDuplicateIdsKeeping = (strategy: 'newest' | 'oldest') => {
    const ids = new Set<string>();
    duplicateGroups.forEach((group) => {
      const sorted = [...group.items].sort((a, b) => {
        const aUploaded = Date.parse(a.uploaded ?? '');
        const bUploaded = Date.parse(b.uploaded ?? '');
        const aTime = Number.isFinite(aUploaded) ? aUploaded : 0;
        const bTime = Number.isFinite(bUploaded) ? bUploaded : 0;
        return strategy === 'newest' ? bTime - aTime : aTime - bTime;
      });
      const keepId = sorted[0]?.id;
      group.items.forEach((asset) => {
        if (asset.id !== keepId) ids.add(asset.id);
      });
    });
    return Array.from(ids);
  };

  const duplicateFiltered = filters.duplicates
    ? baseFiltered.filter((asset) => duplicateIds.has(asset.id))
    : baseFiltered;
  const sorted = [...duplicateFiltered].sort((a, b) => Date.parse(b.uploaded ?? '') - Date.parse(a.uploaded ?? ''));
  const safePage = Math.max(1, Math.floor(page));
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));
  const normalizedFocusAssetId = focusAssetId?.trim() ?? '';
  const focusIndex = normalizedFocusAssetId
    ? sorted.findIndex((asset) => asset.id === normalizedFocusAssetId)
    : -1;
  // When a focus asset is provided and found, return the *natural* page that
  // contains the asset. The asset appears in its real position on that page;
  // the client scrolls and highlights it. We deliberately do NOT anchor the
  // slice to start at the focus -- that misrepresents pagination ("Page 1 of
  // 11" while actually showing items 26-145 of 1312, etc.).
  const focusPage = focusIndex >= 0
    ? Math.floor(focusIndex / safePageSize) + 1
    : null;
  const pageIndex = focusPage ?? Math.min(safePage, totalPages);
  const focus: GalleryQueryFocusResult | null = normalizedFocusAssetId
    ? {
        assetId: normalizedFocusAssetId,
        found: focusIndex >= 0,
        index: focusIndex,
        ordinal: focusIndex >= 0 ? focusIndex + 1 : 0,
        page: focusPage ?? Math.min(safePage, totalPages),
        pageSize: safePageSize,
        total,
      }
    : null;
  const start = (pageIndex - 1) * safePageSize;
  const images = sorted.slice(start, start + safePageSize);
  const pageIds = new Set(images.map((asset) => asset.id));
  const pageFamilySummaryMap = Object.fromEntries(
    Object.entries(familySummaryMapAll).filter(([id]) => pageIds.has(id))
  );
  const pageDuplicateIds = images.filter((asset) => duplicateIds.has(asset.id)).map((asset) => asset.id);

  return {
    images,
    scopeTotal,
    total,
    totalPages,
    page: pageIndex,
    pageSize: safePageSize,
    focus,
    facets,
    familySummaryMap: pageFamilySummaryMap,
    duplicateSummary: {
      groupCount: duplicateGroups.length,
      imageCount: duplicateIds.size,
      pageDuplicateIds,
      allDuplicateIds: Array.from(duplicateIds),
      duplicateIdsExcludingNewest: selectDuplicateIdsKeeping('newest'),
      duplicateIdsExcludingOldest: selectDuplicateIdsKeeping('oldest'),
    },
  };
};
