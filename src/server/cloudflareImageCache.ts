import { cleanString, parseCloudflareMetadata, type CloudflareMetadata } from '@/utils/cloudflareMetadata';
import { normalizeOriginalUrl } from '@/utils/urlNormalization';
import { getCacheStorage, type ICacheStorage } from './cacheStorage';

interface CloudflareImageApiResponse {
  id: string;
  filename?: string;
  uploaded: string;
  variants: string[];
  meta?: unknown;
}

export interface CachedCloudflareImage {
  id: string;
  filename: string;
  uploaded: string;
  variants: string[];
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
}

interface CacheState {
  images: CachedCloudflareImage[];
  map: Map<string, CachedCloudflareImage>;
  lastFetched: number;
  inflight: Promise<CachedCloudflareImage[]> | null;
  initialized: boolean;
  backgroundRefreshInProgress: boolean;
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
  backgroundRefreshInProgress: false
};

const cacheState: CacheState = globalObject[GLOBAL_CACHE_KEY] ?? defaultState;
if (!globalObject[GLOBAL_CACHE_KEY]) {
  globalObject[GLOBAL_CACHE_KEY] = cacheState;
}

const CACHE_TTL_MS = Number(process.env.CLOUDFLARE_CACHE_TTL_MS ?? 5 * 60 * 1000);
const PERSISTENT_CACHE_TTL_MS = Number(process.env.CLOUDFLARE_PERSISTENT_CACHE_TTL_MS ?? 24 * 60 * 60 * 1000); // 24 hours default
const PAGE_SIZE = Math.min(
  100,
  Math.max(10, Number(process.env.CLOUDFLARE_CACHE_PAGE_SIZE ?? 100))
);
const MAX_PAGES = (() => {
  const value = Number(process.env.CLOUDFLARE_CACHE_MAX_PAGES);
  return Number.isFinite(value) && value > 0 ? value : undefined;
})();

const PERSISTENT_CACHE_KEY = 'cloudflare-images';
const METADATA_OVERRIDE_KEY = 'cloudflare-metadata-overrides';

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
  assign('variationParentId', image.parentId);
  assign('linkedAssetId', image.linkedAssetId);
  assign('variationSort', image.variationSort);
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

  return {
    id: image.id,
    filename: image.filename || parsedMeta.filename || 'Unknown',
    uploaded: image.uploaded,
    variants: image.variants,
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

/**
 * Load images from persistent storage (file/Redis)
 * Returns null if cache doesn't exist or is too old
 */
const loadFromPersistentCache = async (): Promise<{ images: CachedCloudflareImage[]; timestamp: number } | null> => {
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
  try {
    await getStorage().set(PERSISTENT_CACHE_KEY, images, timestamp);
    console.log(`[Cache] Saved ${images.length} images to persistent cache`);
  } catch (error) {
    console.warn('[Cache] Failed to save to persistent cache:', error);
  }
};

const shouldUseMemoryCache = (forceRefresh?: boolean) => {
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
  if (cacheState.backgroundRefreshInProgress) {
    return;
  }
  
  cacheState.backgroundRefreshInProgress = true;
  console.log('[Cache] Starting background refresh from Cloudflare API');
  
  fetchAndUpdateCaches()
    .then((images) => {
      console.log(`[Cache] Background refresh complete: ${images.length} images`);
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
  await loadMetadataOverrides();
  // 1. Check in-memory cache first
  if (shouldUseMemoryCache(forceRefresh)) {
    return cacheState.images;
  }

  // 2. If there's already a fetch in progress, wait for it
  if (cacheState.inflight) {
    return cacheState.inflight;
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
    return inflight;
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
  return inflight;
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
  cacheState.map.set(image.id, image);
  const index = cacheState.images.findIndex(item => item.id === image.id);
  if (index >= 0) {
    cacheState.images[index] = image;
  } else {
    cacheState.images.unshift(image);
  }
  cacheState.lastFetched = Date.now();

  void loadMetadataOverrides().then(() => {
    const override = buildMetadataOverride(image);
    if (Object.keys(override).length) {
      metadataOverrides.set(image.id, override);
      saveMetadataOverrides().catch(() => {});
    }
  });
  
  // Update persistent cache in background
  saveToPersistentCache(cacheState.images, cacheState.lastFetched).catch(() => {});
};

export const removeCachedImage = (id: string) => {
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
