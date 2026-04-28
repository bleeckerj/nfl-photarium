import type { ProjectAssetRecord } from './types';

export type PreferredPublicVideoPlaybackKind = 'hls' | 'file';

const isUrl = (value?: string): value is string => {
  if (!value?.trim()) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const isIframeOrWatchUrl = (value?: string): boolean =>
  Boolean(value && /\/(?:iframe|watch)(?:$|\?)/.test(value));

const isDirectVideoFileUrl = (value?: string): boolean =>
  Boolean(
    value &&
      !isIframeOrWatchUrl(value) &&
      !/\/downloads\/default\.mp4(?:\?.*)?$/i.test(value) &&
      /(\.(mp4|webm|mov|m4v)(\?.*)?$)|\/downloads\/[^/?#]+\.(mp4|webm|mov|m4v)(\?.*)?$|\/downloads\/default\.mp4(?:\?.*)?$/i.test(
        value
      )
  );

const isHlsUrl = (value?: string): boolean =>
  Boolean(value && /\/manifest\/video\.m3u8(?:\?.*)?$/i.test(value));

export const resolvePreferredVideoPlayback = (
  asset: Pick<ProjectAssetRecord, 'assetType' | 'videoHlsUrl' | 'videoDownloadUrl' | 'videoPlaybackUrl' | 'videoPreviewUrl'>
): { url: string | null; kind: PreferredPublicVideoPlaybackKind | null } => {
  if (asset.assetType !== 'video') {
    return { url: null, kind: null };
  }

  if (isUrl(asset.videoHlsUrl) && isHlsUrl(asset.videoHlsUrl)) {
    return { url: asset.videoHlsUrl, kind: 'hls' };
  }

  const directFileCandidate = [
    asset.videoDownloadUrl,
    asset.videoPlaybackUrl,
    asset.videoPreviewUrl,
  ].find((candidate) => isUrl(candidate) && isDirectVideoFileUrl(candidate));

  if (directFileCandidate) {
    return { url: directFileCandidate, kind: 'file' };
  }

  return { url: null, kind: null };
};

export const resolveDownloadableVideoUrl = (
  asset: Pick<ProjectAssetRecord, 'assetType' | 'videoDownloadUrl' | 'videoPlaybackUrl' | 'videoPreviewUrl'>
): string | null => {
  if (asset.assetType !== 'video') return null;

  const directFileCandidate = [
    asset.videoDownloadUrl,
    asset.videoPlaybackUrl,
    asset.videoPreviewUrl,
  ].find((candidate) => isUrl(candidate) && isDirectVideoFileUrl(candidate));

  return directFileCandidate ?? null;
};
