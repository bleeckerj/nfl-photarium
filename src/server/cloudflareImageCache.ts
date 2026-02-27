import { cleanString, parseCloudflareMetadata, type CloudflareMetadata } from '@/utils/cloudflareMetadata';
import { normalizeOriginalUrl } from '@/utils/urlNormalization';
import { getCacheStorage, type ICacheStorage } from './cacheStorage';

interface CloudflareImageApiResponse {
  id: string;
  filename?: string;
  uploaded: string;
  variants: string[];
  size?: number;
  meta?: unknown;
}

export interface CachedCloudflareImage {
  id: string;
  filename: string;
  uploaded: string;
  variants: string[];
  size?: number;
  contentType?: string;
  folder?: string;
  tags: string[];
  description?: string;
  originalUrl?: string;
  originalUrlNormalized?: string;
  sourceUrl?: string;
  sourceUrlNormalized?: string;
  namespace?: string;
  contentHash?: string;
  altTag?: string;
  displayName?: string;
  exif?: Record<string, string | number>;
  generatedBy?: string;
  comfyMetadataDetected?: boolean;
  comfyMetadataSource?: string;
  parentId?: string;
  linkedAssetId?: string;
  variationSort?: number;
  
  // Vector search fields (Phase 2)
  /** Whether CLIP embedding has been generated and stored in vector index */
  hasClipEmbedding?: boolean;
  /** Whether color histogram has been generated and stored in vector index */
  hasColorEmbedding?: boolean;
  /** Dominant colors extracted from image (hex codes) */
  dominantColors?: string[];
  /** Average color of image (hex code) */
  averageColor?: string;
  /** Stored aspect ratio label if available (e.g., "3:2") */
  aspectRatio?: string;
  /** Stored image dimensions if available */
  dimensions?: { width: number; height: number };
}

interface CacheState {
  images: CachedCloudflareImage[];
  map: Map<string, CachedCloudflareImage>;
  lastFetched: number;
  inflight: Promise<CachedCloudflareImage[]> | null;
  initialized: boolean;
  backgroundRefreshInProgress: boolean;
  backgroundRefreshLastRun: number;
}

const GLOBAL_CACHE_KEY = Symbol.for('cloudflare.image.cache');
const globalObject = globalThis as typeof globalThis & {
  [GLOBAL_CACHE_KEY]?: CacheState;
};

const defaultState: CacheState = {
  images: [],
  map: new Map(),
  lastFetched: 0,
  inflight: null,
  initialized: false,
  backgroundRefreshInProgress: false,
  backgroundRefreshLastRun: 0
};

const cacheState: CacheState = globalObject[GLOBAL_CACHE_KEY] ?? defaultState;
if (!globalObject[GLOBAL_CACHE_KEY]) {
  globalObject[GLOBAL_CACHE_KEY] = cacheState;
}

const isTruthyEnv = (value?: string): boolean => {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const CLOUDFLARE_CACHE_DISABLED = isTruthyEnv(process.env.CLOUDFLARE_CACHE_DISABLED);

const CACHE_TTL_MS = Number(process.env.CLOUDFLARE_CACHE_TTL_MS ?? 5 * 60 * 1000);
const PERSISTENT_CACHE_TTL_MS = Number(process.env.CLOUDFLARE_PERSISTENT_CACHE_TTL_MS ?? 24 * 60 * 60 * 1000); // 24 hours default
const DEV_BACKGROUND_REFRESH_MIN_MS = Number(
  process.env.CLOUDFLARE_DEV_BACKGROUND_REFRESH_MIN_MS ?? 60 * 60 * 1000
);
const devDisableEnv = process.env.CLOUDFLARE_DEV_BACKGROUND_REFRESH_DISABLED;
const DEV_BACKGROUND_REFRESH_DISABLED =
  process.env.NODE_ENV === 'development'
    ? devDisableEnv !== 'false' && devDisableEnv !== '0'
    : devDisableEnv === 'true' || devDisableEnv === '1';
const PAGE_SIZE = Math.min(
  100,
  Math.max(10, Number(process.env.CLOUDFLARE_CACHE_PAGE_SIZE ?? 100))
);
const MAX_PAGES = (() => {
  const value = Number(process.env.CLOUDFLARE_CACHE_MAX_PAGES);
  return Number.isFinite(value) && value > 0 ? value : undefined;
})();
const SIZE_BACKFILL_ENABLED = process.env.CLOUDFLARE_SIZE_BACKFILL_DISABLED !== 'true';
const SIZE_BACKFILL_MAX_PER_RUN = Math.max(
  1,
  Number(process.env.CLOUDFLARE_SIZE_BACKFILL_MAX_PER_RUN ?? 40)
);
const SIZE_BACKFILL_CONCURRENCY = Math.max(
  1,
  Math.min(10, Number(process.env.CLOUDFLARE_SIZE_BACKFILL_CONCURRENCY ?? 4))
);
const SIZE_BACKFILL_MIN_INTERVAL_MS = Math.max(
  5_000,
  Number(process.env.CLOUDFLARE_SIZE_BACKFILL_MIN_INTERVAL_MS ?? 30_000)
);
const SIZE_BACKFILL_RETRY_MS = Math.max(
  30_000,
  Number(process.env.CLOUDFLARE_SIZE_BACKFILL_RETRY_MS ?? 5 * 60 * 1000)
);

const PERSISTENT_CACHE_KEY = 'cloudflare-images';
const METADATA_OVERRIDE_KEY = 'cloudflare-metadata-overrides';
let sizeBackfillInProgress = false;
let sizeBackfillLastRun = 0;
const sizeBackfillAttempts = new Map<string, number>();

// Get persistent storage instance
let storage: ICacheStorage | null = null;
const getStorage = (): ICacheStorage => {
  if (!storage) {
    storage = getCacheStorage();
  }
  return storage;
};

const metadataOverrides = new Map<string, CloudflareMetadata>();
let metadataOverridesLoaded = false;

const loadMetadataOverrides = async (): Promise<void> => {
  if (CLOUDFLARE_CACHE_DISABLED) return;
  if (metadataOverridesLoaded) return;
  metadataOverridesLoaded = true;
  try {
    const cached = await getStorage().get<Record<string, CloudflareMetadata>>(METADATA_OVERRIDE_KEY);
    if (!cached?.data) return;
    Object.entries(cached.data).forEach(([id, meta]) => {
      if (meta && typeof meta === 'object') {
        metadataOverrides.set(id, meta);
      }
    });
  } catch (error) {
    console.warn('[Cache] Failed to load metadata overrides:', error);
  }
};

const saveMetadataOverrides = async (): Promise<void> => {
  if (CLOUDFLARE_CACHE_DISABLED) return;
  try {
    const payload = Object.fromEntries(metadataOverrides.entries());
    await getStorage().set(METADATA_OVERRIDE_KEY, payload);
  } catch (error) {
    console.warn('[Cache] Failed to save metadata overrides:', error);
  }
};

const buildMetadataOverride = (image: CachedCloudflareImage): CloudflareMetadata => {
  const override: CloudflareMetadata = {};
  const assign = <K extends keyof CloudflareMetadata>(key: K, value: CloudflareMetadata[K]) => {
    if (value !== undefined) {
      override[key] = value;
    }
  };
  assign('folder', image.folder);
  assign('tags', image.tags);
  assign('description', image.description);
  assign('originalUrl', image.originalUrl);
  assign('originalUrlNormalized', image.originalUrlNormalized);
  assign('sourceUrl', image.sourceUrl);
  assign('sourceUrlNormalized', image.sourceUrlNormalized);
  assign('namespace', image.namespace);
  assign('contentHash', image.contentHash);
  assign('altTag', image.altTag);
  assign('displayName', image.displayName);
  assign('generatedBy', image.generatedBy);
  assign('comfyMetadataDetected', image.comfyMetadataDetected);
  assign('comfyMetadataSource', image.comfyMetadataSource);
  assign('variationParentId', image.parentId);
  assign('linkedAssetId', image.linkedAssetId);
  assign('variationSort', image.variationSort);
  assign('size', image.size);
  assign('type', image.contentType);
  return override;
};

const mergeMetadata = (base: CloudflareMetadata, override?: CloudflareMetadata) => {
  if (!override) return base;
  const merged = { ...base } as CloudflareMetadata;
  Object.entries(override).forEach(([key, value]) => {
    if (merged[key as keyof CloudflareMetadata] === undefined && value !== undefined) {
      merged[key as keyof CloudflareMetadata] = value as CloudflareMetadata[keyof CloudflareMetadata];
    }
  });
  return merged;
};

const transformImage = (image: CloudflareImageApiResponse): CachedCloudflareImage => {
  const parsedMeta = parseCloudflareMetadata(image.meta);
  const overrideMeta = metadataOverrides.get(image.id);
  const mergedMeta = mergeMetadata(parsedMeta, overrideMeta);
  const cleanFolder =
    mergedMeta.folder && mergedMeta.folder !== 'undefined' ? mergedMeta.folder : undefined;
  const cleanTags = Array.isArray(mergedMeta.tags)
    ? mergedMeta.tags.filter((tag): tag is string => Boolean(tag) && tag !== 'undefined')
    : [];
  const cleanDescription =
    mergedMeta.description && mergedMeta.description !== 'undefined'
      ? mergedMeta.description
      : undefined;
  const cleanOriginalUrl =
    mergedMeta.originalUrl && mergedMeta.originalUrl !== 'undefined'
      ? mergedMeta.originalUrl
      : undefined;
  const cleanOriginalUrlNormalized =
    mergedMeta.originalUrlNormalized && mergedMeta.originalUrlNormalized !== 'undefined'
      ? mergedMeta.originalUrlNormalized
      : undefined;
  const normalizedOriginalUrl =
    cleanOriginalUrlNormalized ?? normalizeOriginalUrl(cleanOriginalUrl);
  const cleanSourceUrl =
    mergedMeta.sourceUrl && mergedMeta.sourceUrl !== 'undefined'
      ? mergedMeta.sourceUrl
      : undefined;
  const cleanSourceUrlNormalized =
    mergedMeta.sourceUrlNormalized && mergedMeta.sourceUrlNormalized !== 'undefined'
      ? mergedMeta.sourceUrlNormalized
      : undefined;
  const normalizedSourceUrl =
    cleanSourceUrlNormalized ?? normalizeOriginalUrl(cleanSourceUrl);
  const cleanNamespace =
    mergedMeta.namespace && mergedMeta.namespace !== 'undefined'
      ? mergedMeta.namespace
      : undefined;
  const cleanAltTag =
    mergedMeta.altTag && mergedMeta.altTag !== 'undefined' ? mergedMeta.altTag : undefined;
  const displayName =
    mergedMeta.displayName && mergedMeta.displayName !== 'undefined'
      ? mergedMeta.displayName
      : undefined;
  const cleanContentHash =
    mergedMeta.contentHash && mergedMeta.contentHash !== 'undefined'
      ? mergedMeta.contentHash
      : undefined;
  const cleanExif =
    mergedMeta.exif && typeof mergedMeta.exif === 'object' && !Array.isArray(mergedMeta.exif)
      ? (mergedMeta.exif as Record<string, string | number>)
      : undefined;
  const cleanGeneratedBy =
    mergedMeta.generatedBy && mergedMeta.generatedBy !== 'undefined'
      ? String(mergedMeta.generatedBy)
      : undefined;
  const comfyMetadataDetected =
    mergedMeta.comfyMetadataDetected === true || cleanGeneratedBy === 'comfyui'
      ? true
      : undefined;
  const comfyMetadataSource =
    mergedMeta.comfyMetadataSource && mergedMeta.comfyMetadataSource !== 'undefined'
      ? String(mergedMeta.comfyMetadataSource)
      : undefined;
  const cleanVariationSort = (() => {
    if (typeof mergedMeta.variationSort === 'number' && Number.isFinite(mergedMeta.variationSort)) {
      return mergedMeta.variationSort;
    }
    if (typeof mergedMeta.variationSort === 'string') {
      const parsed = Number(mergedMeta.variationSort);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  })();
  const parentId = cleanString(mergedMeta.variationParentId);
  const linkedAssetId = cleanString(mergedMeta.linkedAssetId);
  const parsedSize = (() => {
    const candidates = [mergedMeta.size, mergedMeta.bytes, mergedMeta.fileSize, image.size];
    for (const candidate of candidates) {
      if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0) {
        return candidate;
      }
      if (typeof candidate === 'string') {
        const parsed = Number(candidate);
        if (Number.isFinite(parsed) && parsed >= 0) {
          return parsed;
        }
      }
    }
    return undefined;
  })();
  const contentType = (() => {
    const candidates = [mergedMeta.type, mergedMeta.contentType, mergedMeta.mimeType];
    for (const candidate of candidates) {
      if (typeof candidate === 'string') {
        const trimmed = candidate.trim();
        if (trimmed) return trimmed;
      }
    }
    return undefined;
  })();

  return {
    id: image.id,
    filename: image.filename || parsedMeta.filename || 'Unknown',
    uploaded: image.uploaded,
    variants: image.variants,
    size: parsedSize,
    contentType,
    folder: cleanFolder,
    tags: cleanTags,
    description: cleanDescription,
    originalUrl: cleanOriginalUrl,
    originalUrlNormalized: normalizedOriginalUrl,
    sourceUrl: cleanSourceUrl,
    sourceUrlNormalized: normalizedSourceUrl,
    namespace: cleanNamespace,
    contentHash: cleanContentHash,
    altTag: cleanAltTag,
    displayName: displayName ?? (image.filename || parsedMeta.filename || undefined),
    exif: cleanExif,
    generatedBy: cleanGeneratedBy,
    comfyMetadataDetected,
    comfyMetadataSource,
    variationSort: cleanVariationSort,
    parentId,
    linkedAssetId
  };
};

const fetchPage = async (
  accountId: string,
  apiToken: string,
  page: number
): Promise<CloudflareImageApiResponse[]> => {
  const params = new URLSearchParams({
    per_page: String(PAGE_SIZE),
    page: String(page)
  });

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${apiToken}`
      },
      cache: 'no-store'
    }
  );

  const json = await response.json();
  if (!response.ok) {
    const errorMessage =
      json?.errors?.[0]?.message || 'Failed to fetch Cloudflare Images page.';
    throw new Error(errorMessage);
  }

  return Array.isArray(json?.result?.images) ? json.result.images : [];
};

const fetchAllImages = async (): Promise<CachedCloudflareImage[]> => {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !apiToken) {
    throw new Error('Cloudflare credentials not configured');
  }

  const collected: CloudflareImageApiResponse[] = [];
  let page = 1;

  while (true) {
    const images = await fetchPage(accountId, apiToken, page);
    collected.push(...images);
    if (images.length < PAGE_SIZE) {
      break;
    }
    page += 1;
    if (MAX_PAGES && page > MAX_PAGES) {
      console.warn(
        `Reached CLOUDFLARE_CACHE_MAX_PAGES (${MAX_PAGES}). Results may be incomplete.`
      );
      break;
    }
  }

  return collected.map(transformImage);
};

const parseSizeHeaderValue = (value: string | null): number | undefined => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

const parseContentRangeTotal = (value: string | null): number | undefined => {
  if (!value) return undefined;
  const match = value.match(/\/(\d+)$/);
  if (!match) return undefined;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

const pickVariantUrl = (variants: string[]): string | undefined => {
  if (!Array.isArray(variants) || variants.length === 0) return undefined;
  return variants.find((url) => url.includes('/public')) || variants[0];
};

const fetchVariantContentSize = async (url: string): Promise<number | undefined> => {
  try {
    const head = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    const fromLength = parseSizeHeaderValue(head.headers.get('content-length'));
    if (fromLength !== undefined) {
      return fromLength;
    }
  } catch {
    // Fall through to range request.
  }

  try {
    const ranged = await fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      cache: 'no-store',
    });
    return (
      parseContentRangeTotal(ranged.headers.get('content-range'))
      ?? parseSizeHeaderValue(ranged.headers.get('content-length'))
    );
  } catch {
    return undefined;
  }
};

const getMissingSizeCandidates = () => {
  const now = Date.now();
  const candidates: Array<{ id: string; url: string }> = [];
  for (const image of cacheState.images) {
    if (typeof image.size === 'number' && Number.isFinite(image.size) && image.size >= 0) {
      continue;
    }
    const lastAttemptAt = sizeBackfillAttempts.get(image.id) ?? 0;
    if (now - lastAttemptAt < SIZE_BACKFILL_RETRY_MS) {
      continue;
    }
    const variantUrl = pickVariantUrl(image.variants);
    if (!variantUrl) continue;
    candidates.push({ id: image.id, url: variantUrl });
    if (candidates.length >= SIZE_BACKFILL_MAX_PER_RUN) {
      break;
    }
  }
  return candidates;
};

const runSizeBackfillQueue = async (): Promise<void> => {
  if (!SIZE_BACKFILL_ENABLED || sizeBackfillInProgress) {
    return;
  }
  const now = Date.now();
  if (now - sizeBackfillLastRun < SIZE_BACKFILL_MIN_INTERVAL_MS) {
    return;
  }

  const candidates = getMissingSizeCandidates();
  if (candidates.length === 0) {
    return;
  }

  sizeBackfillInProgress = true;
  sizeBackfillLastRun = now;
  candidates.forEach((candidate) => sizeBackfillAttempts.set(candidate.id, now));

  let cursor = 0;
  const workerCount = Math.min(SIZE_BACKFILL_CONCURRENCY, candidates.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= candidates.length) {
        break;
      }

      const candidate = candidates[index];
      const discoveredSize = await fetchVariantContentSize(candidate.url);
      if (discoveredSize === undefined) {
        continue;
      }

      const existing = cacheState.map.get(candidate.id);
      if (!existing) {
        continue;
      }
      if (typeof existing.size === 'number' && Number.isFinite(existing.size) && existing.size >= 0) {
        continue;
      }
      upsertCachedImage({
        ...existing,
        size: discoveredSize,
      });
      sizeBackfillAttempts.delete(candidate.id);
    }
  });

  try {
    await Promise.all(workers);
  } finally {
    sizeBackfillInProgress = false;
  }
};

const triggerSizeBackfill = (): void => {
  if (!SIZE_BACKFILL_ENABLED) return;
  void runSizeBackfillQueue().catch((error) => {
    console.warn('[Cache] Size backfill queue failed:', error);
  });
};

/**
 * Load images from persistent storage (file/Redis)
 * Returns null if cache doesn't exist or is too old
 */
const loadFromPersistentCache = async (): Promise<{ images: CachedCloudflareImage[]; timestamp: number } | null> => {
  if (CLOUDFLARE_CACHE_DISABLED) return null;
  try {
    const cached = await getStorage().get<CachedCloudflareImage[]>(PERSISTENT_CACHE_KEY);
    if (!cached) {
      console.log('[Cache] No persistent cache found');
      return null;
    }

    const age = Date.now() - cached.timestamp;
    const isStale = age > PERSISTENT_CACHE_TTL_MS;
    
    console.log(`[Cache] Loaded ${cached.data.length} images from persistent cache (age: ${Math.round(age / 1000)}s, stale: ${isStale})`);
    
    // Return data even if stale - we'll refresh in background
    return { images: cached.data, timestamp: cached.timestamp };
  } catch (error) {
    console.warn('[Cache] Failed to load from persistent cache:', error);
    return null;
  }
};

/**
 * Save images to persistent storage
 */
const saveToPersistentCache = async (images: CachedCloudflareImage[], timestamp: number): Promise<void> => {
  if (CLOUDFLARE_CACHE_DISABLED) return;
  try {
    await getStorage().set(PERSISTENT_CACHE_KEY, images, timestamp);
    console.log(`[Cache] Saved ${images.length} images to persistent cache`);
  } catch (error) {
    console.warn('[Cache] Failed to save to persistent cache:', error);
  }
};

const shouldUseMemoryCache = (forceRefresh?: boolean) => {
  if (CLOUDFLARE_CACHE_DISABLED) return false;
  if (forceRefresh) return false;
  if (!cacheState.images.length) return false;
  return Date.now() - cacheState.lastFetched < CACHE_TTL_MS;
};

const rebuildState = (images: CachedCloudflareImage[], timestamp?: number) => {
  cacheState.images = images;
  cacheState.map = new Map(images.map(image => [image.id, image]));
  cacheState.lastFetched = timestamp ?? Date.now();
  cacheState.initialized = true;
};

/**
 * Fetch fresh data from Cloudflare and update both caches
 */
const fetchAndUpdateCaches = async (): Promise<CachedCloudflareImage[]> => {
  const images = await fetchAllImages();
  const timestamp = Date.now();
  
  // Update in-memory cache
  rebuildState(images, timestamp);
  
  // Update persistent cache (fire and forget)
  saveToPersistentCache(images, timestamp).catch(err => {
    console.warn('[Cache] Background save to persistent cache failed:', err);
  });
  
  return images;
};

/**
 * Trigger a background refresh of the cache
 * Doesn't block the current request
 */
const triggerBackgroundRefresh = (): void => {
  if (CLOUDFLARE_CACHE_DISABLED) {
    return;
  }
  if (cacheState.backgroundRefreshInProgress) {
    return;
  }

  if (process.env.NODE_ENV === 'development') {
    if (DEV_BACKGROUND_REFRESH_DISABLED) {
      console.log('[Cache] Skipping background refresh in dev (disabled)');
      return;
    }
    const now = Date.now();
    const sinceLast = now - cacheState.backgroundRefreshLastRun;
    if (sinceLast < DEV_BACKGROUND_REFRESH_MIN_MS) {
      console.log('[Cache] Skipping background refresh in dev (throttled)');
      return;
    }
    cacheState.backgroundRefreshLastRun = now;
  }
  
  cacheState.backgroundRefreshInProgress = true;
  console.log('[Cache] Starting background refresh from Cloudflare API');
  
  fetchAndUpdateCaches()
    .then((images) => {
      console.log(`[Cache] Background refresh complete: ${images.length} images`);
      triggerSizeBackfill();
    })
    .catch((error) => {
      console.warn('[Cache] Background refresh failed:', error);
    })
    .finally(() => {
      cacheState.backgroundRefreshInProgress = false;
    });
};

/**
 * Main entry point for getting cached images
 * 
 * Cache hierarchy:
 * 1. In-memory cache (fastest, TTL: 5 minutes)
 * 2. Persistent cache (fast, TTL: 24 hours)  
 * 3. Cloudflare API (slow, paginated)
 * 
 * On cold start:
 * - Loads from persistent cache immediately (fast)
 * - Triggers background refresh if persistent cache is stale
 */
export const getCachedImages = async (forceRefresh = false): Promise<CachedCloudflareImage[]> => {
  if (!CLOUDFLARE_CACHE_DISABLED) {
    await loadMetadataOverrides();
  }

  if (CLOUDFLARE_CACHE_DISABLED) {
    // Cache-off mode:
    // - normal reads return only this-process transient entries
    // - explicit force refresh still allows one-off direct Cloudflare fetch
    if (!forceRefresh) {
      return cacheState.images;
    }
    if (cacheState.inflight) {
      return cacheState.inflight;
    }
    const inflight = fetchAllImages().finally(() => {
      cacheState.inflight = null;
    });
    cacheState.inflight = inflight;
    return inflight;
  }

  // 1. Check in-memory cache first
  if (shouldUseMemoryCache(forceRefresh)) {
    triggerSizeBackfill();
    return cacheState.images;
  }

  // 2. If there's already a fetch in progress, wait for it
  if (cacheState.inflight) {
    const images = await cacheState.inflight;
    triggerSizeBackfill();
    return images;
  }

  // 3. For force refresh, go straight to Cloudflare API
  if (forceRefresh) {
    const inflight = fetchAndUpdateCaches()
      .catch(error => {
        cacheState.inflight = null;
        if (cacheState.images.length) {
          console.warn('[Cache] Falling back to existing cache after fetch failure:', error);
          return cacheState.images;
        }
        throw error;
      })
      .finally(() => {
        cacheState.inflight = null;
      });

    cacheState.inflight = inflight;
    const images = await inflight;
    triggerSizeBackfill();
    return images;
  }

  // 4. Try to load from persistent cache
  const persistent = await loadFromPersistentCache();
  
  if (persistent && persistent.images.length > 0) {
    // Use persistent cache data
    rebuildState(persistent.images, persistent.timestamp);
    
    // Check if persistent cache is stale and needs background refresh
    const persistentAge = Date.now() - persistent.timestamp;
    if (persistentAge > CACHE_TTL_MS) {
      // Persistent cache is older than memory TTL, trigger background refresh
      triggerBackgroundRefresh();
    }
    triggerSizeBackfill();
    return cacheState.images;
  }

  // 5. No cache available, fetch from Cloudflare API (blocking)
  console.log('[Cache] No cache available, fetching from Cloudflare API...');
  
  const inflight = fetchAndUpdateCaches()
    .catch(error => {
      cacheState.inflight = null;
      throw error;
    })
    .finally(() => {
      cacheState.inflight = null;
    });

  cacheState.inflight = inflight;
  const images = await inflight;
  triggerSizeBackfill();
  return images;
};

/**
 * Synchronous access to the in-memory cache.
 * CRITICAL for duplicate detection: Returns whatever is currently in memory,
 * without triggering any async fetches. This ensures that images uploaded
 * in the current session are visible to subsequent duplicate checks,
 * even if the async cache refresh is still in progress.
 * 
 * May return an empty array if the cache hasn't been initialized yet.
 */
export const getCachedImagesSync = (): CachedCloudflareImage[] => {
  return cacheState.images;
};

export const getCachedImage = async (id: string) => {
  if (CLOUDFLARE_CACHE_DISABLED) {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;
    if (!accountId || !apiToken) {
      return undefined;
    }
    try {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1/${id}`,
        {
          headers: { Authorization: `Bearer ${apiToken}` }
        }
      );
      if (!response.ok) return undefined;
      const data = await response.json();
      return data.result ? transformApiImageToCached(data.result) : undefined;
    } catch (err) {
      console.warn('[Cache] Failed to fetch single image from Cloudflare:', err);
      return undefined;
    }
  }

  // First check in-memory map
  if (cacheState.map.has(id)) {
    return cacheState.map.get(id);
  }
  
  // Try the images array (might be in there but not map due to race condition)
  const images = await getCachedImages();
  const found = images.find(image => image.id === id);
  if (found) {
    return found;
  }
  
  // Image not in cache - try fetching directly from Cloudflare API
  // This handles the case where an image was just uploaded but hasn't propagated
  // to the list API yet, or where cache was refreshed between upload and lookup
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  
  if (accountId && apiToken) {
    try {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1/${id}`,
        {
          headers: { Authorization: `Bearer ${apiToken}` }
        }
      );
      
      if (response.ok) {
        const data = await response.json();
        if (data.result) {
          const cached = transformApiImageToCached(data.result);
          // Add to cache so subsequent lookups are fast
          upsertCachedImage(cached);
          return cached;
        }
      }
    } catch (err) {
      console.warn('[Cache] Failed to fetch single image from Cloudflare:', err);
    }
  }
  
  return undefined;
};

export const refreshCloudflareImageCache = async () => {
  return getCachedImages(true);
};

export const upsertCachedImage = (image: CachedCloudflareImage) => {
  if (CLOUDFLARE_CACHE_DISABLED) {
    cacheState.map.set(image.id, image);
    const index = cacheState.images.findIndex(item => item.id === image.id);
    if (index >= 0) {
      cacheState.images[index] = image;
    } else {
      cacheState.images.unshift(image);
    }
    cacheState.lastFetched = Date.now();
    return;
  }
  const existing = cacheState.map.get(image.id);
  const mergedImage: CachedCloudflareImage = existing
    ? {
        ...existing,
        ...image,
        // Preserve known size/type when metadata-only updates omit these fields.
        size: image.size ?? existing.size,
        contentType: image.contentType ?? existing.contentType,
        aspectRatio: image.aspectRatio ?? existing.aspectRatio,
        dimensions: image.dimensions ?? existing.dimensions,
        hasClipEmbedding: image.hasClipEmbedding ?? existing.hasClipEmbedding,
        hasColorEmbedding: image.hasColorEmbedding ?? existing.hasColorEmbedding,
        dominantColors: image.dominantColors ?? existing.dominantColors,
        averageColor: image.averageColor ?? existing.averageColor,
      }
    : image;

  cacheState.map.set(mergedImage.id, mergedImage);
  const index = cacheState.images.findIndex(item => item.id === image.id);
  if (index >= 0) {
    cacheState.images[index] = mergedImage;
  } else {
    cacheState.images.unshift(mergedImage);
  }
  cacheState.lastFetched = Date.now();

  void loadMetadataOverrides().then(() => {
    const override = buildMetadataOverride(mergedImage);
    if (Object.keys(override).length) {
      metadataOverrides.set(mergedImage.id, override);
      saveMetadataOverrides().catch(() => {});
    }
  });
  
  // Update persistent cache in background
  saveToPersistentCache(cacheState.images, cacheState.lastFetched).catch(() => {});

  if (mergedImage.size === undefined) {
    triggerSizeBackfill();
  }
};

export const removeCachedImage = (id: string) => {
  if (CLOUDFLARE_CACHE_DISABLED) {
    cacheState.map.delete(id);
    cacheState.images = cacheState.images.filter(image => image.id !== id);
    cacheState.lastFetched = Date.now();
    return;
  }
  cacheState.map.delete(id);
  cacheState.images = cacheState.images.filter(image => image.id !== id);
  cacheState.lastFetched = Date.now();
  
  // Update persistent cache in background
  saveToPersistentCache(cacheState.images, cacheState.lastFetched).catch(() => {});
};

export const transformApiImageToCached = (image: CloudflareImageApiResponse) =>
  transformImage(image);

export const getCacheStats = () => ({
  count: cacheState.images.length,
  lastFetched: cacheState.lastFetched,
  ttlMs: CACHE_TTL_MS,
  persistentTtlMs: PERSISTENT_CACHE_TTL_MS,
  disabled: CLOUDFLARE_CACHE_DISABLED,
  initialized: cacheState.initialized,
  backgroundRefreshInProgress: cacheState.backgroundRefreshInProgress
});

/**
 * Force clear all caches (useful for debugging)
 */
export const clearAllCaches = async () => {
  cacheState.images = [];
  cacheState.map = new Map();
  cacheState.lastFetched = 0;
  cacheState.initialized = false;
  metadataOverrides.clear();
  metadataOverridesLoaded = false;
  
  try {
    await getStorage().delete(PERSISTENT_CACHE_KEY);
    await getStorage().delete(METADATA_OVERRIDE_KEY);
    console.log('[Cache] All caches cleared');
  } catch (error) {
    console.warn('[Cache] Failed to clear persistent cache:', error);
  }
};
