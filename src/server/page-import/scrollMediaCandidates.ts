import {
  isBlockedMediaDomain,
  looksLikeImageAssetUrl,
  looksLikeTinyTrackingPixel,
  looksLikeTrackingOrUtilityAsset,
  looksLikeUiChromeAsset,
} from '@/server/pageImportFilters';
import { toImportCandidate } from '@/server/import-metadata/candidates';

export interface ImageInfo {
  kind: 'image';
  url: string;
  filename: string;
  naturalWidth?: number;
  naturalHeight?: number;
  contentLength?: number;
  inMainContent?: boolean;
  inUiChrome?: boolean;
}

export interface VideoInfo {
  kind: 'video';
  url: string;
  filename: string;
  posterUrl?: string;
  isBlob: boolean;
}

export type MediaInfo = ImageInfo | VideoInfo;

const MIN_DIMENSION = 50;

export const isValidUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
};

export const isPrivateHost = (hostname: string) => {
  const lowered = hostname.toLowerCase();
  if (lowered === 'localhost') return true;
  const ipv4Match = /^(\d{1,3}\.){3}\d{1,3}$/.test(lowered);
  if (!ipv4Match) return false;
  const octets = lowered.split('.').map((part) => Number(part));
  if (octets.some((value) => Number.isNaN(value) || value < 0 || value > 255)) {
    return true;
  }
  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
};

export const serializeMediaCandidate = (mediaInfo: MediaInfo) => {
  if (mediaInfo.kind === 'video') {
    const candidate = toImportCandidate({
      kind: 'video',
      url: mediaInfo.url,
      filename: mediaInfo.filename,
      previewUrl: mediaInfo.posterUrl,
      posterUrl: mediaInfo.posterUrl,
      isBlobSource: mediaInfo.isBlob,
      metadata: {
        contentType: mediaInfo.isBlob ? undefined : 'video/unknown',
      },
    });
    return {
      ...candidate,
      isBlob: mediaInfo.isBlob,
      posterUrl: mediaInfo.posterUrl,
    };
  }

  const candidate = toImportCandidate({
    kind: 'image',
    url: mediaInfo.url,
    filename: mediaInfo.filename,
    metadata: {
      dimensions:
        mediaInfo.naturalWidth && mediaInfo.naturalHeight
          ? { width: mediaInfo.naturalWidth, height: mediaInfo.naturalHeight }
          : undefined,
      fileSizeBytes: mediaInfo.contentLength,
      sources: {
        dimensions:
          mediaInfo.naturalWidth && mediaInfo.naturalHeight ? 'browser' : undefined,
        fileSize: typeof mediaInfo.contentLength === 'number' ? 'network' : undefined,
      },
    },
  });
  return {
    ...candidate,
    naturalWidth: mediaInfo.naturalWidth,
    naturalHeight: mediaInfo.naturalHeight,
    contentLength: mediaInfo.contentLength,
    inMainContent: mediaInfo.inMainContent,
    inUiChrome: mediaInfo.inUiChrome,
  };
};

export const pickBestFromSrcset = (srcset: string): string => {
  if (!srcset) return '';

  const candidates: Array<{ url: string; score: number }> = [];
  const parts = srcset.split(',');

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const [url, descriptor] = trimmed.split(/\s+/, 2);
    let score = 1;

    if (descriptor?.endsWith('w')) {
      const width = Number(descriptor.slice(0, -1));
      score = Number.isFinite(width) ? width : 0;
    } else if (descriptor?.endsWith('x')) {
      const ratio = Number(descriptor.slice(0, -1));
      score = Number.isFinite(ratio) ? ratio * 1000 : 0;
    }

    candidates.push({ url, score });
  }

  if (candidates.length === 0) return '';
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].url;
};

export const getFilenameFromUrl = (value: string): string => {
  try {
    const parsed = new URL(value);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const filename = segments[segments.length - 1] || 'remote-image';
    return decodeURIComponent(filename).replace(/[?#].*$/, '');
  } catch {
    return 'remote-image';
  }
};

export const inferVideoFileName = (value: string, fallback = 'remote-video.mp4'): string => {
  try {
    const parsed = new URL(value);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const filename = segments[segments.length - 1];
    if (!filename) return fallback;
    return decodeURIComponent(filename).replace(/[?#].*$/, '');
  } catch {
    const trimmed = value.trim();
    return trimmed || fallback;
  }
};

export const resolveCandidateUrl = (rawUrl: string, baseUrl: string): string | null => {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('javascript:')) {
    return null;
  }

  try {
    const resolved = new URL(trimmed, baseUrl);
    if (!['http:', 'https:'].includes(resolved.protocol)) return null;
    if (isPrivateHost(resolved.hostname)) return null;
    resolved.hash = '';
    return resolved.toString();
  } catch {
    return null;
  }
};

const urlHasSizeHints = (url: string): boolean =>
  /(\d{2,}x\d{2,})|(_\d{3,}w)|(@[23]x)/i.test(url);

export const shouldIncludeImageWithOptions = (
  img: ImageInfo,
  options?: { includeUiChrome?: boolean; includeSmallAssets?: boolean }
): boolean => {
  const includeUiChrome = Boolean(options?.includeUiChrome);
  const includeSmallAssets = Boolean(options?.includeSmallAssets);
  if (isBlockedMediaDomain(img.url)) return false;
  if (!includeUiChrome && looksLikeUiChromeAsset(img.url, img.filename)) return false;
  if (looksLikeTrackingOrUtilityAsset(img.url, img.filename)) return false;
  if (looksLikeTinyTrackingPixel({
    url: img.url,
    filenameHint: img.filename,
    naturalWidth: img.naturalWidth,
    naturalHeight: img.naturalHeight,
    contentLength: img.contentLength,
  })) return false;
  // Lazy-loaded images can report tiny dimensions before the real asset loads.
  if (urlHasSizeHints(img.url)) {
    return true;
  }

  if (img.naturalWidth && img.naturalHeight) {
    if (!includeSmallAssets && img.naturalWidth < MIN_DIMENSION && img.naturalHeight < MIN_DIMENSION) {
      return false;
    }
    return true;
  }

  return looksLikeImageAssetUrl(img.url);
};
