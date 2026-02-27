import { randomUUID } from 'crypto';
import { getCacheStorage } from '@/server/cacheStorage';
import { getStreamVideo } from '@/server/cloudflareStreamClient';
import { calculateAspectRatio } from '@/utils/imageUtils';

export type VideoAssetRecord = {
  id: string;
  assetType: 'video';
  filename: string;
  uploaded: string;
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
  streamSyncedAt?: string;
  streamError?: string;
  hasClipEmbedding?: boolean;
  folder?: string;
  tags: string[];
  description?: string;
  originalUrl?: string;
  sourceUrl?: string;
  namespace?: string;
  createdAt: string;
  updatedAt: string;
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

  return record;
};

export const updateVideoAssetRecord = async (
  id: string,
  patch: Partial<Omit<VideoAssetRecord, 'id' | 'createdAt' | 'updatedAt'>>
): Promise<VideoAssetRecord | null> => {
  const existing = await getVideoAssetRecord(id);
  if (!existing) return null;
  const next: VideoAssetRecord = {
    ...existing,
    ...patch,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };
  await getCacheStorage().set(getRecordKey(id), next);
  return next;
};

export const getVideoAssetRecord = async (id: string): Promise<VideoAssetRecord | null> => {
  const cached = await getCacheStorage().get<VideoAssetRecord>(getRecordKey(id));
  return cached?.data ?? null;
};

export const deleteVideoAssetRecord = async (id: string): Promise<boolean> => {
  const storage = getCacheStorage();
  const existing = await getVideoAssetRecord(id);
  if (!existing) {
    return false;
  }

  await storage.delete(getRecordKey(id));
  const index = await storage.get<string[]>(VIDEO_RECORD_INDEX_KEY);
  const ids = index?.data ?? [];
  const nextIds = ids.filter((entry) => entry !== id);
  await storage.set(VIDEO_RECORD_INDEX_KEY, nextIds);
  return true;
};

export const listVideoAssetRecords = async (): Promise<VideoAssetRecord[]> => {
  const storage = getCacheStorage();
  const index = await storage.get<string[]>(VIDEO_RECORD_INDEX_KEY);
  const ids = index?.data ?? [];
  if (!ids.length) return [];

  const records = await Promise.all(ids.map((id) => getVideoAssetRecord(id)));
  return records
    .filter((record): record is VideoAssetRecord => Boolean(record))
    .sort((a, b) => Date.parse(b.uploaded) - Date.parse(a.uploaded));
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
