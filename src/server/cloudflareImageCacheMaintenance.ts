import type { CloudflareMetadata } from '@/utils/cloudflareMetadata';
import type { CachedCloudflareImage } from './cloudflareImageCacheMapper';
import type { CloudflareImageMutation } from './cloudflareImageMutationJournal';

type CacheState = {
  images: CachedCloudflareImage[];
  map: Map<string, CachedCloudflareImage>;
  contentVersion: number;
  residentAt: number;
  lastFetched: number;
  localMutations: Map<string, CloudflareImageMutation>;
};

export function createSizeBackfill({
  cacheState,
  enabled,
  maxPerRun,
  concurrency,
  minIntervalMs,
  retryMs,
  cacheDisabled,
  recordMutation,
}: {
  cacheState: CacheState;
  enabled: boolean;
  maxPerRun: number;
  concurrency: number;
  minIntervalMs: number;
  retryMs: number;
  cacheDisabled: boolean;
  recordMutation: (mutation: CloudflareImageMutation) => Promise<unknown>;
}) {
  let inProgress = false;
  let lastRun = 0;
  const attempts = new Map<string, number>();

  const parseSize = (value: string | null) => {
    if (!value) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  };
  const parseRangeTotal = (value: string | null) => {
    const match = value?.match(/\/(\d+)$/);
    if (!match) return undefined;
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  };
  const fetchSize = async (url: string) => {
    try {
      const head = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      const size = parseSize(head.headers.get('content-length'));
      if (size !== undefined) return size;
    } catch { /* Range request below is the fallback. */ }
    try {
      const ranged = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' }, cache: 'no-store' });
      return parseRangeTotal(ranged.headers.get('content-range')) ?? parseSize(ranged.headers.get('content-length'));
    } catch { return undefined; }
  };
  const candidates = () => {
    const now = Date.now();
    const result: Array<{ id: string; url: string }> = [];
    for (const image of cacheState.images) {
      if (typeof image.size === 'number' && Number.isFinite(image.size) && image.size >= 0) continue;
      if (now - (attempts.get(image.id) ?? 0) < retryMs) continue;
      const url = image.variants.find((variant) => variant.includes('/public')) ?? image.variants[0];
      if (!url) continue;
      result.push({ id: image.id, url });
      if (result.length >= maxPerRun) break;
    }
    return result;
  };

  const run = async () => {
    if (!enabled || inProgress || Date.now() - lastRun < minIntervalMs) return;
    const pending = candidates();
    if (pending.length === 0) return;
    inProgress = true;
    lastRun = Date.now();
    pending.forEach((candidate) => attempts.set(candidate.id, lastRun));
    let cursor = 0;
    const mutations: CloudflareImageMutation[] = [];
    const workers = Array.from({ length: Math.min(concurrency, pending.length) }, async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= pending.length) return;
        const candidate = pending[index];
        const size = await fetchSize(candidate.url);
        const existing = size === undefined ? undefined : cacheState.map.get(candidate.id);
        if (size === undefined || !existing || (typeof existing.size === 'number' && existing.size >= 0)) continue;
        const updated = { ...existing, size };
        cacheState.map.set(updated.id, updated);
        const imageIndex = cacheState.images.findIndex((image) => image.id === updated.id);
        if (imageIndex >= 0) cacheState.images[imageIndex] = updated;
        const mutation: CloudflareImageMutation = { kind: 'upsert', imageId: updated.id, image: updated, recordedAt: Date.now() };
        cacheState.localMutations.set(updated.id, mutation);
        mutations.push(mutation);
        attempts.delete(candidate.id);
      }
    });
    try {
      await Promise.all(workers);
      if (mutations.length > 0 && !cacheDisabled) {
        cacheState.contentVersion += 1;
        cacheState.residentAt = Date.now();
        cacheState.lastFetched = cacheState.residentAt;
        await Promise.all(mutations.map(recordMutation));
      }
    } finally { inProgress = false; }
  };

  return { run };
}

export function createPersistentCacheMaintenance({
  cacheState,
  cacheDisabled,
  getStorage,
  cacheKey,
  metadataKey,
  persistentTtlMs,
  saveDebounceMs,
  metadataOverrides,
  loadMutations,
  applyMutations,
  compactMutations,
}: {
  cacheState: CacheState;
  cacheDisabled: boolean;
  getStorage: () => { get<T>(key: string): Promise<{ data: T; timestamp: number } | null>; set<T>(key: string, data: T, timestamp?: number): Promise<void> };
  cacheKey: string;
  metadataKey: string;
  persistentTtlMs: number;
  saveDebounceMs: number;
  metadataOverrides: Map<string, CloudflareMetadata>;
  loadMutations: () => Promise<CloudflareImageMutation[]>;
  applyMutations: (images: CachedCloudflareImage[], mutations: CloudflareImageMutation[]) => CachedCloudflareImage[];
  compactMutations: (timestamp: number) => Promise<unknown>;
}) {
  let metadataLoaded = false;
  let metadataTimer: ReturnType<typeof setTimeout> | null = null;
  let metadataInFlight: Promise<void> | null = null;
  let metadataQueued = false;
  let cacheTimer: ReturnType<typeof setTimeout> | null = null;
  let cacheInFlight: Promise<void> | null = null;
  let cacheQueued = false;

  const loadMetadataOverrides = async () => {
    if (cacheDisabled || metadataLoaded) return;
    metadataLoaded = true;
    try {
      const cached = await getStorage().get<Record<string, CloudflareMetadata>>(metadataKey);
      if (cached?.data) Object.entries(cached.data).forEach(([id, meta]) => { if (meta && !metadataOverrides.has(id)) metadataOverrides.set(id, meta); });
    } catch (error) { console.warn('[Cache] Failed to load metadata overrides:', error); }
  };
  const saveMetadataOverrides = async () => {
    if (cacheDisabled) return;
    try { await getStorage().set(metadataKey, Object.fromEntries(metadataOverrides.entries())); }
    catch (error) { console.warn('[Cache] Failed to save metadata overrides:', error); }
  };
  const flushMetadataOverridesSave = async () => {
    if (cacheDisabled) return;
    if (metadataInFlight) { metadataQueued = true; return metadataInFlight; }
    metadataQueued = false;
    metadataInFlight = saveMetadataOverrides().finally(() => { metadataInFlight = null; if (metadataQueued) scheduleMetadataOverridesSave(); });
    return metadataInFlight;
  };
  const scheduleMetadataOverridesSave = () => {
    if (cacheDisabled) return;
    if (metadataTimer) clearTimeout(metadataTimer);
    metadataTimer = setTimeout(() => { metadataTimer = null; void flushMetadataOverridesSave(); }, saveDebounceMs);
  };
  const loadFromPersistentCache = async () => {
    if (cacheDisabled) return null;
    try {
      const [cached, mutations] = await Promise.all([getStorage().get<CachedCloudflareImage[]>(cacheKey), loadMutations()]);
      if (!cached) { console.log('[Cache] No persistent cache found'); return null; }
      const age = Date.now() - cached.timestamp;
      const images = applyMutations(cached.data, mutations);
      console.log(`[Cache] Loaded ${images.length} images from persistent cache (age: ${Math.round(age / 1000)}s, stale: ${age > persistentTtlMs}, journal: ${mutations.length})`);
      return { images, timestamp: cached.timestamp };
    } catch (error) { console.warn('[Cache] Failed to load from persistent cache:', error); return null; }
  };
  const saveToPersistentCache = async (images: CachedCloudflareImage[], timestamp: number) => {
    if (cacheDisabled) return;
    await getStorage().set(cacheKey, images, timestamp);
    await compactMutations(timestamp);
    for (const [imageId, mutation] of cacheState.localMutations) if (mutation.recordedAt <= timestamp) cacheState.localMutations.delete(imageId);
    console.log(`[Cache] Saved ${images.length} images to persistent cache`);
  };
  const flushPersistentCacheSave = async () => {
    if (cacheDisabled) return;
    if (cacheInFlight) { cacheQueued = true; return cacheInFlight; }
    cacheQueued = false;
    cacheInFlight = saveToPersistentCache(cacheState.images.slice(), Date.now()).catch((error) => console.warn('[Cache] Failed to save persistent cache:', error)).finally(() => { cacheInFlight = null; if (cacheQueued) schedulePersistentCacheSave(); });
    return cacheInFlight;
  };
  const schedulePersistentCacheSave = () => {
    if (cacheDisabled) return;
    if (cacheTimer) clearTimeout(cacheTimer);
    cacheTimer = setTimeout(() => { cacheTimer = null; void flushPersistentCacheSave(); }, saveDebounceMs);
  };
  return { loadMetadataOverrides, scheduleMetadataOverridesSave, flushPersistentCacheSave, loadFromPersistentCache };
}
