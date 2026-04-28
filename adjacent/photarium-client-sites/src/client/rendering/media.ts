import type { ClientAsset } from '@client/domain/types';

export type ResolvedVideoPlaybackKind = 'hls' | 'file';

export interface ResolvedVideoPlayback {
  posterUrl: string | null;
  playUrl: string | null;
  playbackKind: ResolvedVideoPlaybackKind | null;
  downloadUrl: string | null;
  durationSeconds: number | null;
  hasPlayableSource: boolean;
  hasDownloadableSource: boolean;
}

const isIframeOrWatchUrl = (value: string | null): boolean =>
  Boolean(value && /\/(?:iframe|watch)(?:$|\?)/.test(value));

const isDirectVideoFileUrl = (value: string | null): boolean =>
  Boolean(
    value &&
      !isIframeOrWatchUrl(value) &&
      !/\/downloads\/default\.mp4(?:\?.*)?$/i.test(value) &&
      /(\.(mp4|webm|mov|m4v)(\?.*)?$)|\/downloads\/[^/?#]+\.(mp4|webm|mov|m4v)(\?.*)?$|\/downloads\/default\.mp4(?:\?.*)?$/i.test(
        value
      )
  );

const isHlsUrl = (value: string | null): boolean =>
  Boolean(value && /\/manifest\/video\.m3u8(?:\?.*)?$/i.test(value));

const normalizeDuration = (value: number | null): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;

export const getAssetPosterUrl = (asset: ClientAsset, preset: 'grid' | 'lightbox'): string | null => {
  if (asset.assetType === 'image') {
    return `/a/${asset.id}/${preset}`;
  }

  return asset.videoThumbnailUrl || null;
};

export const resolveVideoPlayback = (asset: ClientAsset): ResolvedVideoPlayback => {
  if (asset.assetType !== 'video') {
    return {
      posterUrl: null,
      playUrl: null,
      playbackKind: null,
      downloadUrl: null,
      durationSeconds: null,
      hasPlayableSource: false,
      hasDownloadableSource: false,
    };
  }

  const posterUrl = getAssetPosterUrl(asset, 'lightbox');
  const preferredPlaybackUrl = asset.preferredVideoPlaybackUrl;
  const preferredPlaybackKind = asset.preferredVideoPlaybackKind;

  const playUrl =
    preferredPlaybackUrl && preferredPlaybackKind
      ? preferredPlaybackUrl
      : isHlsUrl(asset.videoHlsUrl)
        ? asset.videoHlsUrl
        : [asset.videoDownloadUrl, asset.videoPlaybackUrl, asset.videoPreviewUrl].find(isDirectVideoFileUrl) ?? null;

  const playbackKind =
    preferredPlaybackUrl && preferredPlaybackKind
      ? preferredPlaybackKind
      : isHlsUrl(playUrl)
        ? 'hls'
        : playUrl && isDirectVideoFileUrl(playUrl)
          ? 'file'
          : null;

  const downloadUrl = asset.hasDownloadableVideo
    ? [asset.videoDownloadUrl, asset.videoPlaybackUrl, asset.videoPreviewUrl].find(isDirectVideoFileUrl) ?? null
    : null;

  return {
    posterUrl,
    playUrl,
    playbackKind,
    downloadUrl,
    durationSeconds: normalizeDuration(asset.videoDurationSeconds),
    hasPlayableSource: Boolean(playUrl && playbackKind),
    hasDownloadableSource: Boolean(downloadUrl),
  };
};

export const formatVideoDuration = (durationSeconds: number | null): string | null => {
  if (!durationSeconds) return null;

  const rounded = Math.max(1, Math.round(durationSeconds));
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};
