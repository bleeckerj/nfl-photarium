import { createStreamDownload, getStreamDownloads } from '@/server/cloudflareStreamClient';
import { createMuxAssetFromUrl, getMuxAsset } from '@/server/muxClient';
import {
  getVideoAssetRecord,
  updateVideoAssetRecord,
  type VideoAssetRecord,
  type VideoMuxMetadata,
} from '@/server/videoCatalogStorage';
import { resolveVideoDownloadUrls } from '@/server/videoDownloadUrl';

const firstNonEmpty = (values: Array<string | undefined>) =>
  values.find((value) => typeof value === 'string' && value.trim().length > 0)?.trim() || '';

const getStreamPreparedDownloadUrl = async (video: VideoAssetRecord) => {
  if (!video.streamUid) return '';
  try {
    const existing = await getStreamDownloads(video.streamUid);
    if (existing?.default?.status === 'ready' && existing.default.url) {
      return existing.default.url.trim();
    }

    const created = await createStreamDownload(video.streamUid);
    if (created?.status === 'ready' && created.url) {
      return created.url.trim();
    }
  } catch {
    // Ignore and fallback to resolver candidates.
  }
  return '';
};

const resolveMuxInputUrl = async (video: VideoAssetRecord) => {
  const streamDownloadUrl = await getStreamPreparedDownloadUrl(video);
  if (streamDownloadUrl) return streamDownloadUrl;

  const fallback = firstNonEmpty(resolveVideoDownloadUrls(video));
  if (fallback) return fallback;

  return firstNonEmpty([video.sourceUrl, video.originalUrl]);
};

const mapMuxStatus = (value?: string): VideoMuxMetadata['status'] => {
  if (value === 'ready') return 'ready';
  if (value === 'errored') return 'error';
  return 'ingesting';
};

export const syncMuxMetadata = async (videoId: string) => {
  const video = await getVideoAssetRecord(videoId);
  if (!video) {
    throw new Error('Video not found');
  }
  if (!video.mux?.assetId) {
    return video;
  }

  try {
    const asset = await getMuxAsset(video.mux.assetId);
    const playbackIds = Array.isArray(asset.playback_ids)
      ? asset.playback_ids.map((entry) => entry.id).filter(Boolean)
      : [];
    const playbackId = playbackIds[0];
    const playbackUrl = playbackId ? `https://stream.mux.com/${playbackId}.m3u8` : undefined;

    const updated = await updateVideoAssetRecord(video.id, {
      mux: {
        ...video.mux,
        status: mapMuxStatus(asset.status),
        playbackId,
        playbackIds,
        playbackUrl,
        syncedAt: new Date().toISOString(),
        error: asset.status === 'errored'
          ? asset.errors?.messages?.[0] || 'Mux asset errored'
          : undefined,
      },
    });
    return updated || video;
  } catch (error) {
    const updated = await updateVideoAssetRecord(video.id, {
      mux: {
        ...video.mux,
        status: 'error',
        syncedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Mux sync failed',
      },
    });
    return updated || video;
  }
};

export const startMuxExport = async (params: {
  videoId: string;
  force?: boolean;
  playbackPolicy?: 'public' | 'signed';
}) => {
  const video = await getVideoAssetRecord(params.videoId);
  if (!video) {
    throw new Error('Video not found');
  }

  const existing = video.mux;
  if (
    existing?.assetId &&
    !params.force &&
    existing.status !== 'error'
  ) {
    return syncMuxMetadata(video.id);
  }

  const inputUrl = await resolveMuxInputUrl(video);
  if (!inputUrl) {
    throw new Error('No valid source URL available for Mux ingest.');
  }

  const created = await createMuxAssetFromUrl({
    inputUrl,
    playbackPolicy: params.playbackPolicy || 'public',
    passthrough: video.id,
  });
  const playbackIds = Array.isArray(created.playback_ids)
    ? created.playback_ids.map((entry) => entry.id).filter(Boolean)
    : [];
  const playbackId = playbackIds[0];
  const playbackUrl = playbackId ? `https://stream.mux.com/${playbackId}.m3u8` : undefined;

  const updated = await updateVideoAssetRecord(video.id, {
    mux: {
      assetId: created.id,
      status: mapMuxStatus(created.status),
      ingestUrl: inputUrl,
      playbackId,
      playbackIds,
      playbackUrl,
      exportedAt: new Date().toISOString(),
      syncedAt: new Date().toISOString(),
      error: undefined,
    },
  });

  return updated || video;
};

