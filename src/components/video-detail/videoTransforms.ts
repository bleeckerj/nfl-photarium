import { cleanString } from '@/utils/cloudflareMetadata';
import type { VariantAssignmentCandidate } from '@/utils/variantAssignmentCandidates';

export type VideoRecord = {
  id: string;
  assetType?: 'video';
  generatedBy?: string;
  comfyMetadataDetected?: boolean;
  comfyMetadataSource?: string;
  filename: string;
  displayName?: string;
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
  mux?: {
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
};

export type AssetRecord = {
  id: string;
  assetType?: 'image' | 'video';
  generatedBy?: string;
  comfyMetadataDetected?: boolean;
  comfyMetadataSource?: string;
  filename: string;
  displayName?: string;
  uploaded: string;
  variants?: string[];
  size?: number;
  folder?: string;
  tags?: string[];
  description?: string;
  altTag?: string;
  altText?: string;
  parentId?: string;
  namespace?: string;
  variationSort?: number;
  videoPlaybackUrl?: string;
  videoHlsUrl?: string;
  videoThumbnailUrl?: string;
  videoPreviewUrl?: string;
};

export type FamilyContextResponse = {
  familyAssets?: AssetRecord[];
  candidateAssets?: AssetRecord[];
  assignmentCandidates?: VariantAssignmentCandidate<AssetRecord>[];
  timings?: Record<string, number>;
  diagnostics?: Record<string, unknown>;
};

export type VariationDraft = {
  id: string;
  filename: string;
  maxWidth: string;
  maxOutputMb: string;
  fps: string;
  loop: boolean;
};

export type GenerationSummary = {
  createdCount: number;
  failedCount: number;
  partial: boolean;
  variations: Array<{
    imageId: string;
    url: string;
    filename: string;
    bytes: number;
    width?: number;
    height?: number;
    fps: number;
    loop: boolean;
    encoder?: string;
  }>;
  errors: Array<{ index: number; filename: string; error: string }>;
  hints: string[];
};

export type FramePreviewEntry = {
  frameNumber: number;
  timeSeconds: number;
  previewUrl: string;
};

export type FrameMeta = {
  durationSeconds: number;
  fps: number;
  frameCount: number;
  exactFrameCount: boolean;
  midpointFrame: number;
  defaultSelector: string;
  previews: FramePreviewEntry[];
  currentFrame?: FramePreviewEntry;
  limits?: {
    maxExtractFrameCount?: number;
  };
};

export type ActiveFramePreview = {
  frameNumber: number;
  timeSeconds: number;
  objectUrl: string;
};

export type DownloadProbeState = {
  status: 'idle' | 'checking' | 'ready' | 'preparing' | 'unavailable' | 'error';
  message?: string;
};

const MAX_OUTPUT_MB_DEFAULT = 10;
const DETAIL_PERF_LOGGING_ENABLED = process.env.NODE_ENV !== 'production';

export const getNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export const logVideoDetailPerf = (
  label: string,
  startedAt: number,
  extra?: Record<string, unknown>
) => {
  if (!DETAIL_PERF_LOGGING_ENABLED) return;
  const elapsedMs = Math.round(getNow() - startedAt);
  console.info(`[VideoDetailPerf] ${label} ${elapsedMs}ms`, extra ?? {});
};

export const PRESET_MAP = {
  preview: { maxWidth: '640', maxOutputMb: '2', fps: '8' },
  balanced: { maxWidth: '960', maxOutputMb: '6', fps: '12' },
  quality: { maxWidth: '1280', maxOutputMb: '10', fps: '15' },
} as const;

export const extractAssignmentCandidateAssets = (payload: FamilyContextResponse): AssetRecord[] => {
  if (!Array.isArray(payload.assignmentCandidates)) {
    return [];
  }
  return payload.assignmentCandidates.flatMap((candidate) =>
    [candidate.asset, candidate.parentAsset].filter((asset): asset is AssetRecord => Boolean(asset?.id))
  );
};

export const mergeUniqueAssetsById = (base: AssetRecord[], incoming: AssetRecord[]) => {
  const merged = new Map<string, AssetRecord>();
  base.forEach((entry) => merged.set(entry.id, entry));
  incoming.forEach((entry) => {
    const existing = merged.get(entry.id);
    merged.set(entry.id, existing ? { ...existing, ...entry } : entry);
  });
  return Array.from(merged.values());
};

export const videoRecordFromSeed = (asset: AssetRecord): VideoRecord => ({
  id: asset.id,
  assetType: 'video',
  generatedBy: asset.generatedBy,
  comfyMetadataDetected: asset.comfyMetadataDetected,
  comfyMetadataSource: asset.comfyMetadataSource,
  filename: asset.filename,
  displayName: asset.displayName || asset.filename,
  uploaded: asset.uploaded,
  parentId: asset.parentId,
  variationSort: asset.variationSort,
  streamUid: '',
  playbackUrl: asset.videoPlaybackUrl,
  hlsUrl: asset.videoHlsUrl,
  thumbnailUrl: asset.videoThumbnailUrl,
  previewUrl: asset.videoPreviewUrl,
  videoStatus: 'ready',
  folder: asset.folder,
  tags: asset.tags ?? [],
  description: asset.description,
  namespace: asset.namespace,
});

export const createVariationDraft = (seed?: Partial<VariationDraft>): VariationDraft => ({
  id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  filename: seed?.filename ?? '',
  maxWidth: seed?.maxWidth ?? '960',
  maxOutputMb: seed?.maxOutputMb ?? String(MAX_OUTPUT_MB_DEFAULT),
  fps: seed?.fps ?? '12',
  loop: seed?.loop ?? true,
});

export const toOptionalPositiveInt = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.round(parsed);
};

export const toOptionalPositiveNumber = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
};

export const formatBytes = (bytes: number) => {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

export const formatDuration = (seconds?: number) => {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return '--';
  const rounded = Math.max(0, Math.round(seconds));
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export const formatFrameTime = (seconds?: number) => {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '--';
  if (seconds < 1) return `${seconds.toFixed(2)}s`;
  return `${formatDuration(seconds)}.${Math.floor((seconds % 1) * 100).toString().padStart(2, '0')}`;
};

export const normalizeTags = (value: string) =>
  Array.from(new Set(value
    .split(',')
    .map((tag) => cleanString(tag))
    .filter((tag): tag is string => Boolean(tag))
  ));

export const sortFamilyAssets = (items: AssetRecord[]) => {
  const hasSort = items.some((item) => Number.isFinite(item.variationSort));
  if (!hasSort) {
    return [...items].sort((a, b) => Date.parse(b.uploaded) - Date.parse(a.uploaded));
  }
  const baseIndex = new Map(items.map((item, index) => [item.id, index]));
  return [...items].sort((a, b) => {
    const aSort = Number.isFinite(a.variationSort) ? (a.variationSort as number) : null;
    const bSort = Number.isFinite(b.variationSort) ? (b.variationSort as number) : null;
    if (aSort === null && bSort === null) {
      return (baseIndex.get(a.id) ?? 0) - (baseIndex.get(b.id) ?? 0);
    }
    if (aSort === null) return 1;
    if (bSort === null) return -1;
    if (aSort !== bSort) return aSort - bSort;
    return (baseIndex.get(a.id) ?? 0) - (baseIndex.get(b.id) ?? 0);
  });
};
