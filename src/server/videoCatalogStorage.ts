import { randomUUID } from 'crypto';
import { getCacheStorage } from '@/server/cacheStorage';
import { getStreamVideo } from '@/server/cloudflareStreamClient';
import { calculateAspectRatio } from '@/utils/imageUtils';
import { deleteVideoExtrasRecord } from '@/server/videoExtras';

export type VideoAssetRecord = {
  id: string;
  assetType: 'video';
  generatedBy?: string;
  comfyMetadataDetected?: boolean;
  comfyMetadataSource?: string;
  filename: string;
  displayName?: string;
  fileSizeBytes?: number;
  uploaded: string;
  parentId?: string;
  variationSort?: number;
  streamUid: string;
  playbackUrl?: string;
  hlsUrl?: string;
  thumbnailUrl?: string;
  previewUrl?: string;
  durationSeconds?: number;
  videoStatus: 'pending' | 'ready' | 'error';
  width?: number;
  height?: number;
  aspectRatio?: string;
  rotatedFromId?: string;
  rotatedAt?: string;
  rotationDegrees?: number;
  streamSyncedAt?: string;
  streamError?: string;
  hasClipEmbedding?: boolean;
  folder?: string;
  tags: string[];
  description?: string;
  originalUrl?: string;
  sourceUrl?: string;
  namespace?: string;
  mux?: VideoMuxMetadata;
  animatedWebpImageId?: string;
  animatedWebpUrl?: string;
  animatedWebpStatus?: 'pending' | 'ready' | 'error';
  animatedWebpError?: string;
  animatedWebpUpdatedAt?: string;
  animatedWebpBytes?: number;
  animatedWebpWidth?: number;
  animatedWebpHeight?: number;
  animatedWebpVariants?: Array<{
    imageId: string;
    url?: string;
    filename: string;
    bytes: number;
    width?: number;
    height?: number;
    fps: number;
    loop: boolean;
    maxWidth: number;
    maxHeight: number;
    maxOutputBytes: number;
    timeoutMs: number;
    encoder?: string;
    createdAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
};

export type VideoMuxMetadata = {
  assetId: string;
  status: 'queued' | 'ingesting' | 'ready' | 'error';
  ingestUrl?: string;
  playbackId?: string;
  playbackIds?: string[];
  playbackUrl?: string;
  exportedAt?: string;
  syncedAt?: string;
  error?: string;
};

type VideoAssetRecordInput = Omit<VideoAssetRecord, 'id' | 'createdAt' | 'updatedAt'> & {
  id?: string;
};

const VIDEO_RECORD_KEY_PREFIX = 'video-asset';
const VIDEO_RECORD_INDEX_KEY = 'video-asset-index';
const VIDEO_STREAM_SYNC_INTERVAL_MS = Math.max(
  5_000,
  Number(process.env.VIDEO_STREAM_SYNC_INTERVAL_MS ?? 30_000)
);
const VIDEO_STREAM_SYNC_BATCH_SIZE = Math.max(
  1,
  Number(process.env.VIDEO_STREAM_SYNC_BATCH_SIZE ?? 8)
);
const VIDEO_STREAM_SYNC_ON_LIST = process.env.VIDEO_STREAM_SYNC_ON_LIST === '1';

const getRecordKey = (id: string) => `${VIDEO_RECORD_KEY_PREFIX}:${id}`;

// -- In-memory video catalog cache -----------------------------------------
// Previously every gallery / search / family request triggered an index GET
// plus N parallel record GETs (~523 round-trips at the time of writing) -- a
// steady-state cost of ~30ms even when the data hadn't changed. We now hold
// the full record set in memory after first load and update it write-through
// on create/update/delete. This mirrors the cloudflareImageCache pattern and
// keeps reads instant for the hot path.
interface VideoCacheState {
  records: VideoAssetRecord[];           // sorted newest-first
  map: Map<string, VideoAssetRecord>;
  lastFetched: number;
  inflight: Promise<VideoAssetRecord[]> | null;
  initialized: boolean;
  // Bumped whenever the record set actually changes. Downstream caches (e.g.
  // the gallery ETag) include this in their keys, so TTL repopulates that find
  // identical data must NOT bump it.
  version: number;
  fingerprint: string;
}

const VIDEO_CACHE_KEY = Symbol.for('photarium.videoCatalog.cache');
const videoCacheGlobal = globalThis as typeof globalThis & {
  [VIDEO_CACHE_KEY]?: VideoCacheState;
};
const videoCacheState: VideoCacheState = videoCacheGlobal[VIDEO_CACHE_KEY] ?? {
  records: [],
  map: new Map(),
  lastFetched: 0,
  inflight: null,
  initialized: false,
  version: 0,
  fingerprint: '',
};
if (!videoCacheGlobal[VIDEO_CACHE_KEY]) {
  videoCacheGlobal[VIDEO_CACHE_KEY] = videoCacheState;
}

const VIDEO_CACHE_TTL_MS = (() => {
  const raw = Number(process.env.VIDEO_CACHE_TTL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 5 * 60 * 1000;
})();

const sortVideoRecordsByUploadedDesc = (records: VideoAssetRecord[]) =>
  [...records].sort((a, b) => Date.parse(b.uploaded) - Date.parse(a.uploaded));

const commitVideoCacheRecords = (sorted: VideoAssetRecord[]) => {
  const fingerprint = JSON.stringify(sorted);
  if (fingerprint !== videoCacheState.fingerprint) {
    videoCacheState.fingerprint = fingerprint;
    videoCacheState.version += 1;
  }
  videoCacheState.records = sorted;
  videoCacheState.map = new Map(sorted.map((record) => [record.id, record]));
};

const populateVideoCacheFromStorage = async (): Promise<VideoAssetRecord[]> => {
  const storage = getCacheStorage();
  const index = await storage.get<string[]>(VIDEO_RECORD_INDEX_KEY);
  const ids = index?.data ?? [];
  if (!ids.length) {
    commitVideoCacheRecords([]);
    videoCacheState.lastFetched = Date.now();
    videoCacheState.initialized = true;
    return [];
  }
  // One MGET instead of N gets when the backend supports it (~523 round-trips
  // at the time the per-id fan-out was written).
  const records = storage.getMany
    ? (await storage.getMany<VideoAssetRecord>(ids.map(getRecordKey)))
        .map((cached) => cached?.data ?? null)
    : await Promise.all(
        ids.map((id) =>
          storage.get<VideoAssetRecord>(getRecordKey(id)).then((cached) => cached?.data ?? null)
        )
      );
  const valid = records.filter((r): r is VideoAssetRecord => Boolean(r));
  const sorted = sortVideoRecordsByUploadedDesc(valid);
  commitVideoCacheRecords(sorted);
  videoCacheState.lastFetched = Date.now();
  videoCacheState.initialized = true;
  return sorted;
};

const ensureVideoCacheFresh = async (): Promise<VideoAssetRecord[]> => {
  const now = Date.now();
  const isFresh =
    videoCacheState.initialized &&
    now - videoCacheState.lastFetched < VIDEO_CACHE_TTL_MS;
  if (isFresh) return videoCacheState.records;
  if (videoCacheState.inflight) return videoCacheState.inflight;
  const promise = populateVideoCacheFromStorage().finally(() => {
    videoCacheState.inflight = null;
  });
  videoCacheState.inflight = promise;
  return promise;
};

const upsertVideoInCache = (record: VideoAssetRecord) => {
  if (!videoCacheState.initialized) return;
  const next = videoCacheState.records.filter((entry) => entry.id !== record.id);
  next.push(record);
  commitVideoCacheRecords(sortVideoRecordsByUploadedDesc(next));
};

const removeVideoFromCache = (id: string) => {
  if (!videoCacheState.initialized) return;
  commitVideoCacheRecords(videoCacheState.records.filter((entry) => entry.id !== id));
};

export const invalidateVideoAssetCache = () => {
  videoCacheState.records = [];
  videoCacheState.map = new Map();
  videoCacheState.lastFetched = 0;
  videoCacheState.initialized = false;
  videoCacheState.inflight = null;
  videoCacheState.fingerprint = '';
  videoCacheState.version += 1;
};

export const getVideoAssetCatalogVersion = () => videoCacheState.version;

export const getVideoAssetCacheStats = () => ({
  count: videoCacheState.records.length,
  lastFetched: videoCacheState.lastFetched,
  ttlMs: VIDEO_CACHE_TTL_MS,
  initialized: videoCacheState.initialized,
});

const normalizeStatus = (readyToStream?: boolean, state?: string) => {
  if (readyToStream === true) return 'ready' as const;
  if ((state || '').toLowerCase() === 'error') return 'error' as const;
  return 'pending' as const;
};

const parseNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
};

const resolveDimensions = (payload: unknown) => {
  if (!payload || typeof payload !== 'object') {
    return { width: undefined, height: undefined };
  }
  const typed = payload as Record<string, unknown>;
  const input = typed.input && typeof typed.input === 'object'
    ? typed.input as Record<string, unknown>
    : undefined;
  const width = parseNumber(input?.width ?? typed.width);
  const height = parseNumber(input?.height ?? typed.height);
  return { width, height };
};

const shouldSyncRecord = (record: VideoAssetRecord, now: number) => {
  const lastSyncAt = record.streamSyncedAt ? Date.parse(record.streamSyncedAt) : 0;
  const recentlySynced = Number.isFinite(lastSyncAt) && lastSyncAt > 0
    ? now - lastSyncAt < VIDEO_STREAM_SYNC_INTERVAL_MS
    : false;
  if (recentlySynced) return false;
  if (record.videoStatus === 'pending') return true;
  if (!record.width || !record.height || !record.aspectRatio) return true;
  return false;
};

// Always reads from durable storage, bypassing the in-memory cache. Used by
// write paths (update / delete) so they don't risk overwriting another
// process's newer write with cached fields.
const getVideoAssetRecordFromStorage = async (id: string): Promise<VideoAssetRecord | null> => {
  const cached = await getCacheStorage().get<VideoAssetRecord>(getRecordKey(id));
  return cached?.data ?? null;
};

export const createVideoAssetRecord = async (
  input: VideoAssetRecordInput
): Promise<VideoAssetRecord> => {
  const storage = getCacheStorage();
  const now = new Date().toISOString();
  const id = input.id || randomUUID();
  const record: VideoAssetRecord = {
    ...input,
    id,
    tags: input.tags ?? [],
    createdAt: now,
    updatedAt: now,
  };

  await storage.set(getRecordKey(id), record);

  const existingIndex = await storage.get<string[]>(VIDEO_RECORD_INDEX_KEY);
  const nextIndex = new Set(existingIndex?.data ?? []);
  nextIndex.add(id);
  await storage.set(VIDEO_RECORD_INDEX_KEY, Array.from(nextIndex));

  upsertVideoInCache(record);
  return record;
};

export const updateVideoAssetRecord = async (
  id: string,
  patch: Partial<Omit<VideoAssetRecord, 'id' | 'createdAt' | 'updatedAt'>>
): Promise<VideoAssetRecord | null> => {
  const existing = await getVideoAssetRecordFromStorage(id);
  if (!existing) return null;
  const next: VideoAssetRecord = {
    ...existing,
    ...patch,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };
  await getCacheStorage().set(getRecordKey(id), next);
  upsertVideoInCache(next);
  return next;
};

export const getVideoAssetRecord = async (id: string): Promise<VideoAssetRecord | null> => {
  // Fast path: in-memory cache hit. Populates the cache on first access.
  if (videoCacheState.initialized) {
    const hit = videoCacheState.map.get(id);
    if (hit) return hit;
    // The cache is initialized but doesn't have this id. It's either a
    // record that was created in another process after our last populate,
    // or genuinely not present. Fall through to storage and, if found,
    // backfill the cache.
  } else {
    // Trigger a populate so subsequent calls hit the cache. Don't await --
    // we serve this request from storage.
    void ensureVideoCacheFresh();
  }
  const fresh = await getVideoAssetRecordFromStorage(id);
  if (fresh) upsertVideoInCache(fresh);
  return fresh;
};

export const deleteVideoAssetRecord = async (id: string): Promise<boolean> => {
  const storage = getCacheStorage();
  const existing = await getVideoAssetRecordFromStorage(id);
  if (!existing) {
    return false;
  }

  await storage.delete(getRecordKey(id));
  await deleteVideoExtrasRecord(id);
  const index = await storage.get<string[]>(VIDEO_RECORD_INDEX_KEY);
  const ids = index?.data ?? [];
  const nextIds = ids.filter((entry) => entry !== id);
  await storage.set(VIDEO_RECORD_INDEX_KEY, nextIds);
  removeVideoFromCache(id);
  return true;
};

export const listVideoAssetRecords = async (): Promise<VideoAssetRecord[]> => {
  const records = await ensureVideoCacheFresh();
  // Return a shallow copy so callers cannot accidentally mutate our cache.
  return records.slice();
};

export const syncVideoAssetRecordFromStream = async (
  record: VideoAssetRecord
): Promise<VideoAssetRecord> => {
  try {
    const stream = await getStreamVideo(record.streamUid);
    const nextStatus = normalizeStatus(stream.readyToStream, stream.status?.state);
    const { width, height } = resolveDimensions(stream);
    const ratio = width && height
      ? calculateAspectRatio(width, height).common
      : record.aspectRatio;
    const updated = await updateVideoAssetRecord(record.id, {
      videoStatus: nextStatus,
      durationSeconds: typeof stream.duration === 'number' ? stream.duration : record.durationSeconds,
      thumbnailUrl: stream.thumbnail || record.thumbnailUrl,
      previewUrl: stream.preview || record.previewUrl,
      width: width ?? record.width,
      height: height ?? record.height,
      aspectRatio: ratio,
      streamSyncedAt: new Date().toISOString(),
      streamError: undefined,
    });
    const nextRecord = updated || record;
    if (!nextRecord.hasClipEmbedding && (nextRecord.thumbnailUrl || nextRecord.previewUrl)) {
      const { queueAutoEmbeddingsForVideo } = await import('@/server/videoEmbeddingService');
      void queueAutoEmbeddingsForVideo(nextRecord);
    }
    return nextRecord;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const updated = await updateVideoAssetRecord(record.id, {
      streamSyncedAt: new Date().toISOString(),
      streamError: message,
    });
    return updated || record;
  }
};

export const listVideoAssetRecordsWithSync = async (): Promise<VideoAssetRecord[]> => {
  const records = await listVideoAssetRecords();
  if (!records.length) return records;
  if (!VIDEO_STREAM_SYNC_ON_LIST) return records;

  const now = Date.now();
  const toSync = records
    .filter((record) => shouldSyncRecord(record, now))
    .slice(0, VIDEO_STREAM_SYNC_BATCH_SIZE);
  if (!toSync.length) return records;

  const synced = await Promise.all(toSync.map((record) => syncVideoAssetRecordFromStream(record)));
  const byId = new Map(records.map((record) => [record.id, record]));
  for (const record of synced) {
    byId.set(record.id, record);
  }

  return Array.from(byId.values()).sort((a, b) => Date.parse(b.uploaded) - Date.parse(a.uploaded));
};

export const getVideoAssetRecordWithSync = async (id: string): Promise<VideoAssetRecord | null> => {
  const record = await getVideoAssetRecord(id);
  if (!record) return null;
  const now = Date.now();
  if (!shouldSyncRecord(record, now)) return record;
  return syncVideoAssetRecordFromStream(record);
};
