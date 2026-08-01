import type { CloudflareMetadata } from '@/utils/cloudflareMetadata';
import { getCacheStorage, type ICacheStorage } from './cacheStorage';
import {
  buildMetadataOverride,
  transformImage,
  type CachedCloudflareImage,
  type CloudflareImageApiResponse,
} from './cloudflareImageCacheMapper';
import {
  acknowledgeCloudflareImageMutations,
  applyCloudflareImageMutations,
  clearCloudflareImageMutationJournal,
  compactCloudflareImageMutationJournal,
  getCloudflareImageMutations,
  recordCloudflareImageMutation,
  type CloudflareImageMutation,
} from './cloudflareImageMutationJournal';
import {
  cachedImageRecordsEqual,
  catalogContentsEqual,
  mergeCachedImageRecord,
  mutationIsReflectedRemotely,
} from './cloudflareImageReconciliation';
import { fetchAllCloudflareImagePages } from './cloudflareImageListFetcher';

export type {
  CachedCloudflareImage,
  CloudflareImageApiResponse,
} from './cloudflareImageCacheMapper';

interface CacheState {
  images: CachedCloudflareImage[];
  map: Map<string, CachedCloudflareImage>;
  contentVersion: number;
  residentAt: number;
  lastFetched: number;
  lastReconciledAt: number;
  lastReconcileDurationMs: number;
  lastReconcileError: string | null;
  source: 'empty' | 'memory' | 'persistent' | 'cloudflare';
  inflight: Promise<CachedCloudflareImage[]> | null;
  initialized: boolean;
  backgroundRefreshInProgress: boolean;
  backgroundRefreshLastRun: number;
  localMutations: Map<string, CloudflareImageMutation>;
}

const GLOBAL_CACHE_KEY = Symbol.for('cloudflare.image.cache');
const globalObject = globalThis as typeof globalThis & {
  [GLOBAL_CACHE_KEY]?: CacheState;
};

const defaultState: CacheState = {
  images: [],
  map: new Map(),
  contentVersion: 0,
  residentAt: 0,
  lastFetched: 0,
  lastReconciledAt: 0,
  lastReconcileDurationMs: 0,
  lastReconcileError: null,
  source: 'empty',
  inflight: null,
  initialized: false,
  backgroundRefreshInProgress: false,
  backgroundRefreshLastRun: 0,
  localMutations: new Map(),
};

const cacheState: CacheState = globalObject[GLOBAL_CACHE_KEY] ?? defaultState;
if (!globalObject[GLOBAL_CACHE_KEY]) {
  globalObject[GLOBAL_CACHE_KEY] = cacheState;
}
cacheState.contentVersion ??= 0;
cacheState.residentAt ??= cacheState.lastFetched ?? 0;
cacheState.lastReconciledAt ??= cacheState.lastFetched ?? 0;
cacheState.lastReconcileDurationMs ??= 0;
cacheState.lastReconcileError ??= null;
cacheState.source ??= cacheState.initialized ? 'memory' : 'empty';
cacheState.localMutations ??= new Map();

const isTruthyEnv = (value?: string): boolean => {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const CLOUDFLARE_CACHE_DISABLED = isTruthyEnv(process.env.CLOUDFLARE_CACHE_DISABLED);

const CACHE_TTL_MS = Number(process.env.CLOUDFLARE_CACHE_TTL_MS ?? 60 * 1000);
const PERSISTENT_CACHE_TTL_MS = Number(process.env.CLOUDFLARE_PERSISTENT_CACHE_TTL_MS ?? 24 * 60 * 60 * 1000); // 24 hours default
const DEV_BACKGROUND_REFRESH_MIN_MS = Number(
  process.env.CLOUDFLARE_DEV_BACKGROUND_REFRESH_MIN_MS ?? 60 * 1000
);
const devDisableEnv = process.env.CLOUDFLARE_DEV_BACKGROUND_REFRESH_DISABLED;
const DEV_BACKGROUND_REFRESH_DISABLED =
  devDisableEnv === 'true' || devDisableEnv === '1';
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
let persistentCacheSaveTimer: ReturnType<typeof setTimeout> | null = null;
let persistentCacheSaveInFlight: Promise<void> | null = null;
let persistentCacheSaveQueued = false;
let metadataOverridesSaveTimer: ReturnType<typeof setTimeout> | null = null;
let metadataOverridesSaveInFlight: Promise<void> | null = null;
let metadataOverridesSaveQueued = false;
const PERSISTENT_CACHE_SAVE_DEBOUNCE_MS = Math.max(
  50,
  Number(process.env.CLOUDFLARE_PERSISTENT_CACHE_SAVE_DEBOUNCE_MS ?? 750)
);
const METADATA_OVERRIDES_SAVE_DEBOUNCE_MS = Math.max(
  50,
  Number(process.env.CLOUDFLARE_METADATA_OVERRIDES_SAVE_DEBOUNCE_MS ?? 750)
);

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
        if (!metadataOverrides.has(id)) {
          metadataOverrides.set(id, meta);
        }
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

const flushMetadataOverridesSave = async (): Promise<void> => {
  if (CLOUDFLARE_CACHE_DISABLED) return;
  if (metadataOverridesSaveInFlight) {
    metadataOverridesSaveQueued = true;
    return metadataOverridesSaveInFlight;
  }

  metadataOverridesSaveQueued = false;
  metadataOverridesSaveInFlight = saveMetadataOverrides()
    .finally(() => {
      metadataOverridesSaveInFlight = null;
      if (metadataOverridesSaveQueued) {
        scheduleMetadataOverridesSave();
      }
    });
  return metadataOverridesSaveInFlight;
};

const scheduleMetadataOverridesSave = (): void => {
  if (CLOUDFLARE_CACHE_DISABLED) return;
  if (metadataOverridesSaveTimer) {
    clearTimeout(metadataOverridesSaveTimer);
  }
  metadataOverridesSaveTimer = setTimeout(() => {
    metadataOverridesSaveTimer = null;
    void flushMetadataOverridesSave();
  }, METADATA_OVERRIDES_SAVE_DEBOUNCE_MS);
};

const fetchAllImages = async (): Promise<CachedCloudflareImage[]> => {
  const collected = await fetchAllCloudflareImagePages();
  return collected.map((image) => transformImage(image, metadataOverrides.get(image.id)));
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
  const mutations: CloudflareImageMutation[] = [];
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
      const updated: CachedCloudflareImage = {
        ...existing,
        size: discoveredSize,
      };
      cacheState.map.set(updated.id, updated);
      const imageIndex = cacheState.images.findIndex((image) => image.id === updated.id);
      if (imageIndex >= 0) {
        cacheState.images[imageIndex] = updated;
      }
      const mutation: CloudflareImageMutation = {
        kind: 'upsert',
        imageId: updated.id,
        image: updated,
        recordedAt: Date.now(),
      };
      cacheState.localMutations.set(updated.id, mutation);
      mutations.push(mutation);
      sizeBackfillAttempts.delete(candidate.id);
    }
  });

  try {
    await Promise.all(workers);
    if (mutations.length > 0 && !CLOUDFLARE_CACHE_DISABLED) {
      cacheState.contentVersion += 1;
      cacheState.residentAt = Date.now();
      cacheState.lastFetched = cacheState.residentAt;
      await Promise.all(mutations.map((mutation) => recordCloudflareImageMutation(mutation)));
    }
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
    const [cached, mutations] = await Promise.all([
      getStorage().get<CachedCloudflareImage[]>(PERSISTENT_CACHE_KEY),
      getCloudflareImageMutations(),
    ]);
    if (!cached) {
      console.log('[Cache] No persistent cache found');
      return null;
    }

    const age = Date.now() - cached.timestamp;
    const isStale = age > PERSISTENT_CACHE_TTL_MS;
    const images = applyCloudflareImageMutations(cached.data, mutations);
    
    console.log(
      `[Cache] Loaded ${images.length} images from persistent cache `
      + `(age: ${Math.round(age / 1000)}s, stale: ${isStale}, journal: ${mutations.length})`
    );
    
    // Return data even if stale - we'll refresh in background
    return { images, timestamp: cached.timestamp };
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
  await getStorage().set(PERSISTENT_CACHE_KEY, images, timestamp);
  await compactCloudflareImageMutationJournal(timestamp);
  for (const [imageId, mutation] of cacheState.localMutations) {
    if (mutation.recordedAt <= timestamp) {
      cacheState.localMutations.delete(imageId);
    }
  }
  console.log(`[Cache] Saved ${images.length} images to persistent cache`);
};

const flushPersistentCacheSave = async (): Promise<void> => {
  if (CLOUDFLARE_CACHE_DISABLED) return;
  if (persistentCacheSaveInFlight) {
    persistentCacheSaveQueued = true;
    return persistentCacheSaveInFlight;
  }

  persistentCacheSaveQueued = false;
  const images = cacheState.images.slice();
  const timestamp = Date.now();
  persistentCacheSaveInFlight = saveToPersistentCache(images, timestamp)
    .catch((error) => {
      console.warn('[Cache] Failed to save persistent cache:', error);
    })
    .finally(() => {
      persistentCacheSaveInFlight = null;
      if (persistentCacheSaveQueued) {
        schedulePersistentCacheSave();
      }
    });
  return persistentCacheSaveInFlight;
};

const schedulePersistentCacheSave = (): void => {
  if (CLOUDFLARE_CACHE_DISABLED) return;
  if (persistentCacheSaveTimer) {
    clearTimeout(persistentCacheSaveTimer);
  }
  persistentCacheSaveTimer = setTimeout(() => {
    persistentCacheSaveTimer = null;
    void flushPersistentCacheSave();
  }, PERSISTENT_CACHE_SAVE_DEBOUNCE_MS);
};

const hasResidentMemorySnapshot = () => {
  if (CLOUDFLARE_CACHE_DISABLED) return false;
  return cacheState.initialized && cacheState.images.length > 0;
};

const shouldReconcileMemorySnapshot = () => {
  if (!hasResidentMemorySnapshot()) return false;
  return Date.now() - cacheState.lastReconciledAt >= CACHE_TTL_MS;
};

const rebuildState = (
  images: CachedCloudflareImage[],
  options: {
    reconciledAt?: number;
    source?: CacheState['source'];
    incrementVersion?: boolean;
  } = {}
) => {
  cacheState.images = images;
  cacheState.map = new Map(images.map(image => [image.id, image]));
  cacheState.residentAt = Date.now();
  cacheState.lastFetched = cacheState.residentAt;
  cacheState.lastReconciledAt = options.reconciledAt ?? cacheState.lastReconciledAt;
  cacheState.source = options.source ?? cacheState.source;
  if (options.incrementVersion !== false) {
    cacheState.contentVersion += 1;
  }
  cacheState.initialized = true;
};

/**
 * Fetch fresh data from Cloudflare and update both caches
 */
const fetchAndUpdateCaches = async (): Promise<CachedCloudflareImage[]> => {
  const startedAt = Date.now();
  const previousMap = new Map(cacheState.map);
  const fetchedImages = (await fetchAllImages()).map((image) =>
    mergeCachedImageRecord(previousMap.get(image.id), image)
  );
  const fetchedMap = new Map(fetchedImages.map((image) => [image.id, image]));
  const timestamp = Date.now();
  const persistedMutations = await getCloudflareImageMutations();
  const localMutations = Array.from(cacheState.localMutations.values());
  const mutationsById = new Map<string, CloudflareImageMutation>();
  [...persistedMutations, ...localMutations].forEach((mutation) => {
    const existing = mutationsById.get(mutation.imageId);
    if (!existing || existing.recordedAt <= mutation.recordedAt) {
      mutationsById.set(mutation.imageId, mutation);
    }
  });
  const acknowledgedMutations: CloudflareImageMutation[] = [];
  const pendingMutations: CloudflareImageMutation[] = [];
  for (const mutation of mutationsById.values()) {
    if (mutationIsReflectedRemotely(mutation, fetchedMap.get(mutation.imageId))) {
      acknowledgedMutations.push(mutation);
      cacheState.localMutations.delete(mutation.imageId);
    } else {
      pendingMutations.push(mutation);
    }
  }
  const images = applyCloudflareImageMutations(fetchedImages, pendingMutations);
  const contentChanged = !catalogContentsEqual(previousMap, images);
  
  // Update in-memory cache
  rebuildState(images, {
    reconciledAt: timestamp,
    source: 'cloudflare',
    incrementVersion: contentChanged,
  });
  cacheState.lastReconcileDurationMs = Date.now() - startedAt;
  cacheState.lastReconcileError = null;
  void acknowledgeCloudflareImageMutations(acknowledgedMutations).catch((error) => {
    console.warn('[Cache] Failed to compact reconciled image mutations:', error);
  });

  // Reconciliation is not on the request path. Compacting the snapshot here
  // would stringify the entire catalog on the Node event loop, so local writes
  // remain durable in the small journal and the full snapshot is compacted by
  // the explicit persistence flush/maintenance path.

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
  if (cacheState.backgroundRefreshInProgress || cacheState.inflight) {
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
  
  const inflight = fetchAndUpdateCaches()
    .then((images) => {
      console.log(`[Cache] Background refresh complete: ${images.length} images`);
      triggerSizeBackfill();
      return images;
    })
    .catch((error) => {
      cacheState.lastReconcileError = error instanceof Error ? error.message : String(error);
      console.warn('[Cache] Background refresh failed:', error);
      return cacheState.images;
    })
    .finally(() => {
      if (cacheState.inflight === inflight) {
        cacheState.inflight = null;
      }
      cacheState.backgroundRefreshInProgress = false;
    });
  cacheState.inflight = inflight;
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

  // 1. A resident snapshot is always the navigation fast path. Its TTL only
  // controls when reconciliation is scheduled; age never makes an ordinary
  // request synchronously reread the full persistent catalog.
  if (!forceRefresh && hasResidentMemorySnapshot()) {
    cacheState.source = 'memory';
    if (shouldReconcileMemorySnapshot()) {
      triggerBackgroundRefresh();
    }
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
    // Use persistent cache data. We deliberately pass Date.now() (not the
    // persistent timestamp) so the in-memory TTL is measured from when this
    // data became resident in memory, not from when it was originally saved.
    // Without this, a persistent cache older than CACHE_TTL_MS would make
    // shouldUseMemoryCache() return false on every subsequent request,
    // forcing each one to re-load the full image array from Redis/disk
    // (~200-400ms) instead of hitting the in-memory copy (~5ms). The
    // persistent timestamp is still used below for the staleness check that
    // decides whether to schedule a background refresh from Cloudflare.
    rebuildState(persistent.images, {
      reconciledAt: persistent.timestamp,
      source: 'persistent',
    });

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
  await flushPersistentCacheSave();
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
          await upsertCachedImage(cached);
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

export const flushCloudflareImageCachePersistence = async (): Promise<void> => {
  await flushPersistentCacheSave();
};

export const upsertCachedImage = (image: CachedCloudflareImage): Promise<void> => {
  const recordedAt = Date.now();
  if (CLOUDFLARE_CACHE_DISABLED) {
    cacheState.map.set(image.id, image);
    const index = cacheState.images.findIndex(item => item.id === image.id);
    if (index >= 0) {
      cacheState.images[index] = image;
    } else {
      cacheState.images.unshift(image);
    }
    cacheState.residentAt = recordedAt;
    cacheState.lastFetched = recordedAt;
    cacheState.contentVersion += 1;
    cacheState.source = 'memory';
    return Promise.resolve();
  }
  const existing = cacheState.map.get(image.id);
  const mergedImage = mergeCachedImageRecord(existing, image);
  const shouldPersistClearedFolder =
    Boolean(existing?.folder) &&
    Object.prototype.hasOwnProperty.call(image, 'folder') &&
    image.folder === undefined;
  const shouldPersistClearedParent =
    Boolean(existing?.parentId) &&
    Object.prototype.hasOwnProperty.call(image, 'parentId') &&
    image.parentId === undefined;

  // No-op writes (e.g. read-path enrichment re-persisting identical data) must
  // not bump contentVersion: that key invalidates every gallery memo and the
  // client's warm caches, which is what made return-from-detail slow.
  if (
    !shouldPersistClearedFolder &&
    !shouldPersistClearedParent &&
    cachedImageRecordsEqual(existing, mergedImage)
  ) {
    return Promise.resolve();
  }

  cacheState.map.set(mergedImage.id, mergedImage);
  const index = cacheState.images.findIndex(item => item.id === image.id);
  if (index >= 0) {
    cacheState.images[index] = mergedImage;
  } else {
    cacheState.images.unshift(mergedImage);
  }
  cacheState.residentAt = recordedAt;
  cacheState.lastFetched = recordedAt;
  cacheState.contentVersion += 1;
  cacheState.source = 'memory';
  const mutation: CloudflareImageMutation = {
    kind: 'upsert',
    imageId: mergedImage.id,
    image: mergedImage,
    recordedAt,
  };
  cacheState.localMutations.set(mergedImage.id, mutation);

  void loadMetadataOverrides().then(() => {
    const currentImage = cacheState.map.get(mergedImage.id);
    if (!currentImage || currentImage !== mergedImage) {
      return;
    }
    const existingOverride = metadataOverrides.get(mergedImage.id);
    const shouldPreserveClearedParent =
      existingOverride?.variationParentId === '' &&
      !mergedImage.parentId;
    const override = buildMetadataOverride(mergedImage, {
      clearFolder: shouldPersistClearedFolder,
      clearParentId: shouldPersistClearedParent || shouldPreserveClearedParent,
    });
    if (Object.keys(override).length) {
      metadataOverrides.set(mergedImage.id, override);
      scheduleMetadataOverridesSave();
    }
  });
  
  if (mergedImage.size === undefined) {
    triggerSizeBackfill();
  }
  return recordCloudflareImageMutation(mutation);
};

export const removeCachedImage = (id: string): Promise<void> => {
  const recordedAt = Date.now();
  if (CLOUDFLARE_CACHE_DISABLED) {
    cacheState.map.delete(id);
    cacheState.images = cacheState.images.filter(image => image.id !== id);
    cacheState.residentAt = recordedAt;
    cacheState.lastFetched = recordedAt;
    cacheState.contentVersion += 1;
    cacheState.source = 'memory';
    return Promise.resolve();
  }
  cacheState.map.delete(id);
  cacheState.images = cacheState.images.filter(image => image.id !== id);
  cacheState.residentAt = recordedAt;
  cacheState.lastFetched = recordedAt;
  cacheState.contentVersion += 1;
  cacheState.source = 'memory';
  const mutation: CloudflareImageMutation = {
    kind: 'delete',
    imageId: id,
    recordedAt,
  };
  cacheState.localMutations.set(id, mutation);
  return recordCloudflareImageMutation(mutation);
};

export const transformApiImageToCached = (image: CloudflareImageApiResponse) =>
  transformImage(image, metadataOverrides.get(image.id));

export const getCacheStats = () => ({
  count: cacheState.images.length,
  contentVersion: cacheState.contentVersion,
  residentAt: cacheState.residentAt,
  lastFetched: cacheState.lastFetched,
  lastReconciledAt: cacheState.lastReconciledAt,
  lastReconcileDurationMs: cacheState.lastReconcileDurationMs,
  lastReconcileError: cacheState.lastReconcileError,
  source: cacheState.source,
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
  cacheState.contentVersion = 0;
  cacheState.residentAt = 0;
  cacheState.lastFetched = 0;
  cacheState.lastReconciledAt = 0;
  cacheState.lastReconcileDurationMs = 0;
  cacheState.lastReconcileError = null;
  cacheState.source = 'empty';
  cacheState.initialized = false;
  cacheState.localMutations = new Map();
  metadataOverrides.clear();
  metadataOverridesLoaded = false;
  
  try {
    await getStorage().delete(PERSISTENT_CACHE_KEY);
    await getStorage().delete(METADATA_OVERRIDE_KEY);
    await clearCloudflareImageMutationJournal();
    console.log('[Cache] All caches cleared');
  } catch (error) {
    console.warn('[Cache] Failed to clear persistent cache:', error);
  }
};
