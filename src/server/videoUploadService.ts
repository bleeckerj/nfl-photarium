import { createStreamVideoFromFile, createStreamVideoFromUrl } from '@/server/cloudflareStreamClient';
import { createVideoAssetRecord, type VideoAssetRecord } from '@/server/videoCatalogStorage';
import { cleanString } from '@/utils/cloudflareMetadata';
import { calculateAspectRatio } from '@/utils/imageUtils';
import { queueAutoEmbeddingsForVideo } from '@/server/videoEmbeddingService';

export const MAX_VIDEO_BYTES = Math.max(
  5 * 1024 * 1024,
  Number(process.env.MAX_VIDEO_UPLOAD_BYTES ?? 100 * 1024 * 1024)
);

export const SUPPORTED_VIDEO_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/ogg',
]);

const VIDEO_EXTENSION_TO_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  ogv: 'video/ogg',
  ogg: 'video/ogg',
};

export type VideoUploadContext = {
  folder?: string;
  tags: string[];
  description?: string;
  displayName?: string;
  originalUrl?: string;
  sourceUrl?: string;
  namespace?: string;
  parentId?: string;
  requireSignedUrls?: boolean;
};

export type VideoUploadSuccess = {
  id: string;
  assetType: 'video';
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

export type VideoUploadFailureReason =
  | 'invalid-type'
  | 'too-large'
  | 'upload'
  | 'invalid-url';

export type VideoUploadOutcome =
  | { ok: true; data: VideoUploadSuccess }
  | { ok: false; error: string; status: number; reason: VideoUploadFailureReason };

const cleanTags = (tags: string[]) => tags.map((tag) => tag.trim()).filter(Boolean);

const cleanVideoContext = (context: VideoUploadContext): VideoUploadContext => ({
  folder: cleanString(context.folder),
  tags: cleanTags(context.tags ?? []),
  description: cleanString(context.description),
  displayName: cleanString(context.displayName),
  originalUrl: cleanString(context.originalUrl),
  sourceUrl: cleanString(context.sourceUrl),
  namespace: cleanString(context.namespace),
  parentId: cleanString(context.parentId),
  requireSignedUrls: context.requireSignedUrls === true,
});

const isExplicitNamespace = (value?: string) =>
  Boolean(value && value !== '__all__' && value !== '__none__' && value !== 'undefined');

const inferMimeTypeFromFilename = (fileName: string) => {
  const extension = fileName.split('.').pop()?.toLowerCase();
  if (!extension) return undefined;
  return VIDEO_EXTENSION_TO_MIME[extension];
};

const normalizeVideoStatus = (result: { readyToStream?: boolean; status?: { state?: string } }) => {
  if (result.readyToStream === true) return 'ready' as const;
  if (result.status?.state?.toLowerCase() === 'error') return 'error' as const;
  return 'pending' as const;
};

const getVideoDeliveryBase = () =>
  {
    const customerSubdomain = cleanString(process.env.CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN);
    return customerSubdomain
      ? `https://${customerSubdomain}.cloudflarestream.com`
      : 'https://videodelivery.net';
  };

const inferVideoDeliveryBase = (result: { thumbnail?: string; preview?: string }) => {
  const candidates = [result.thumbnail, result.preview].filter(Boolean) as string[];
  for (const candidate of candidates) {
    try {
      const parsed = new URL(candidate);
      if (/\.cloudflarestream\.com$/i.test(parsed.host) || parsed.host === 'videodelivery.net') {
        return parsed.origin;
      }
    } catch {
      continue;
    }
  }
  return getVideoDeliveryBase();
};

const buildPlaybackUrl = (streamUid: string, deliveryBase?: string) => `${deliveryBase || getVideoDeliveryBase()}/${streamUid}/iframe`;
const buildHlsUrl = (streamUid: string, deliveryBase?: string) => `${deliveryBase || getVideoDeliveryBase()}/${streamUid}/manifest/video.m3u8`;

const mapRecordToResponse = (record: VideoAssetRecord): VideoUploadSuccess => ({
  id: record.id,
  assetType: 'video',
  filename: record.filename,
  displayName: record.displayName ?? record.filename,
  uploaded: record.uploaded,
  parentId: record.parentId,
  variationSort: record.variationSort,
  streamUid: record.streamUid,
  playbackUrl: record.playbackUrl,
  hlsUrl: record.hlsUrl,
  thumbnailUrl: record.thumbnailUrl,
  previewUrl: record.previewUrl,
  durationSeconds: record.durationSeconds,
  videoStatus: record.videoStatus,
  width: record.width,
  height: record.height,
  aspectRatio: record.aspectRatio,
  hasClipEmbedding: record.hasClipEmbedding,
  folder: record.folder,
  tags: record.tags,
  description: record.description,
  originalUrl: record.originalUrl,
  sourceUrl: record.sourceUrl,
  namespace: record.namespace,
  mux: record.mux,
  animatedWebpImageId: record.animatedWebpImageId,
  animatedWebpUrl: record.animatedWebpUrl,
  animatedWebpStatus: record.animatedWebpStatus,
  animatedWebpError: record.animatedWebpError,
  animatedWebpUpdatedAt: record.animatedWebpUpdatedAt,
  animatedWebpBytes: record.animatedWebpBytes,
  animatedWebpWidth: record.animatedWebpWidth,
  animatedWebpHeight: record.animatedWebpHeight,
  animatedWebpVariants: record.animatedWebpVariants,
});

const parseNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
};

const resolveVideoDimensions = (result: unknown) => {
  if (!result || typeof result !== 'object') {
    return { width: undefined, height: undefined, aspectRatio: undefined };
  }
  const typed = result as Record<string, unknown>;
  const input = typed.input && typeof typed.input === 'object'
    ? typed.input as Record<string, unknown>
    : undefined;
  const width = parseNumber(input?.width ?? typed.width);
  const height = parseNumber(input?.height ?? typed.height);
  const aspectRatio = width && height ? calculateAspectRatio(width, height).common : undefined;
  return { width, height, aspectRatio };
};

export async function uploadVideoBuffer(
  {
    buffer,
    fileName,
    fileType,
    fileSize,
    context,
  }: {
    buffer: Buffer;
    fileName: string;
    fileType?: string;
    fileSize: number;
    context: VideoUploadContext;
  }
): Promise<VideoUploadOutcome> {
  const cleanedContext = cleanVideoContext(context);
  if (!isExplicitNamespace(cleanedContext.namespace)) {
    return {
      ok: false,
      error: 'A specific namespace is required for uploads. Select a namespace instead of All.',
      status: 400,
      reason: 'invalid-type',
    };
  }
  const normalizedFileType = cleanString(fileType)?.toLowerCase() || inferMimeTypeFromFilename(fileName);

  if (!normalizedFileType || !SUPPORTED_VIDEO_TYPES.has(normalizedFileType)) {
    return { ok: false, error: 'File must be a supported video type', status: 400, reason: 'invalid-type' };
  }

  if (fileSize > MAX_VIDEO_BYTES) {
    return {
      ok: false,
      error: `Video exceeds limit of ${(MAX_VIDEO_BYTES / 1024 / 1024).toFixed(0)}MB`,
      status: 400,
      reason: 'too-large',
    };
  }

  try {
    const result = await createStreamVideoFromFile({
      buffer,
      fileName,
      contentType: normalizedFileType,
      meta: {
        filename: fileName,
        namespace: cleanedContext.namespace || '',
      },
      requireSignedUrls: cleanedContext.requireSignedUrls,
    });
    const dimensions = resolveVideoDimensions(result);
    const deliveryBase = inferVideoDeliveryBase(result);

    const record = await createVideoAssetRecord({
      assetType: 'video',
      filename: fileName,
      displayName: cleanedContext.displayName || fileName,
      uploaded: new Date().toISOString(),
      parentId: cleanedContext.parentId,
      streamUid: result.uid,
      playbackUrl: buildPlaybackUrl(result.uid, deliveryBase),
      hlsUrl: buildHlsUrl(result.uid, deliveryBase),
      thumbnailUrl: result.thumbnail,
      previewUrl: result.preview,
      durationSeconds: typeof result.duration === 'number' ? result.duration : undefined,
      videoStatus: normalizeVideoStatus(result),
      width: dimensions.width,
      height: dimensions.height,
      aspectRatio: dimensions.aspectRatio,
      folder: cleanedContext.folder,
      tags: cleanedContext.tags,
      description: cleanedContext.description,
      originalUrl: cleanedContext.originalUrl,
      sourceUrl: cleanedContext.sourceUrl,
      namespace: cleanedContext.namespace,
    });
    void queueAutoEmbeddingsForVideo(record);

    return { ok: true, data: mapRecordToResponse(record) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to upload video',
      status: 502,
      reason: 'upload',
    };
  }
}

export async function uploadVideoFromRemoteUrl(
  {
    sourceUrl,
    fileName,
    context,
  }: {
    sourceUrl: string;
    fileName?: string;
    context: VideoUploadContext;
  }
): Promise<VideoUploadOutcome> {
  const cleanedContext = cleanVideoContext(context);
  if (!isExplicitNamespace(cleanedContext.namespace)) {
    return {
      ok: false,
      error: 'A specific namespace is required for uploads. Select a namespace instead of All.',
      status: 400,
      reason: 'invalid-url',
    };
  }
  const cleanSourceUrl = cleanString(sourceUrl);
  if (!cleanSourceUrl) {
    return { ok: false, error: 'A valid video URL is required', status: 400, reason: 'invalid-url' };
  }

  try {
    const parsed = new URL(cleanSourceUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { ok: false, error: 'A valid video URL is required', status: 400, reason: 'invalid-url' };
    }
  } catch {
    return { ok: false, error: 'A valid video URL is required', status: 400, reason: 'invalid-url' };
  }

  try {
    const result = await createStreamVideoFromUrl({
      sourceUrl: cleanSourceUrl,
      meta: {
        filename: fileName || '',
        namespace: cleanedContext.namespace || '',
      },
      requireSignedUrls: cleanedContext.requireSignedUrls,
    });
    const dimensions = resolveVideoDimensions(result);
    const deliveryBase = inferVideoDeliveryBase(result);

    const inferredFilename = cleanString(fileName) || cleanSourceUrl.split('/').filter(Boolean).pop() || 'remote-video.mp4';
    const record = await createVideoAssetRecord({
      assetType: 'video',
      filename: inferredFilename,
      displayName: cleanedContext.displayName || inferredFilename,
      uploaded: new Date().toISOString(),
      parentId: cleanedContext.parentId,
      streamUid: result.uid,
      playbackUrl: buildPlaybackUrl(result.uid, deliveryBase),
      hlsUrl: buildHlsUrl(result.uid, deliveryBase),
      thumbnailUrl: result.thumbnail,
      previewUrl: result.preview,
      durationSeconds: typeof result.duration === 'number' ? result.duration : undefined,
      videoStatus: normalizeVideoStatus(result),
      width: dimensions.width,
      height: dimensions.height,
      aspectRatio: dimensions.aspectRatio,
      folder: cleanedContext.folder,
      tags: cleanedContext.tags,
      description: cleanedContext.description,
      originalUrl: cleanedContext.originalUrl ?? cleanSourceUrl,
      sourceUrl: cleanedContext.sourceUrl ?? cleanSourceUrl,
      namespace: cleanedContext.namespace,
    });
    void queueAutoEmbeddingsForVideo(record);

    return { ok: true, data: mapRecordToResponse(record) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to import remote video',
      status: 502,
      reason: 'upload',
    };
  }
}
