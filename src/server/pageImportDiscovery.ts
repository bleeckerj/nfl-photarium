import {
  looksLikeTinyTrackingPixel,
  looksLikeTrackingOrUtilityAsset,
  looksLikeUiChromeAsset,
} from '@/server/pageImportFilters';
import { toImportCandidate } from '@/server/import-metadata/candidates';
import {
  buildSmallAssetFileSizeReview,
  DEFAULT_SMALL_ASSET_THRESHOLD_BYTES,
} from '@/features/page-import/utils/smallAssetPolicy';

export const DEFAULT_PAGE_IMPORT_MIN_BYTES = DEFAULT_SMALL_ASSET_THRESHOLD_BYTES;

export type PageImportHeadInfo = {
  contentLength?: number;
  contentType?: string;
};

type DiscoverPageMediaParams = {
  html: string;
  sourceUrl?: string;
  smallAssetThresholdBytes: number;
  maxImages?: number;
  includeUiChrome: boolean;
  includeSmallAssets: boolean;
  fetchHeadInfo: (url: string) => Promise<PageImportHeadInfo>;
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

const extractBaseHref = (html: string) => {
  const match = html.match(/<base[^>]*href=["']([^"']+)["'][^>]*>/i);
  return match?.[1];
};

const parseAttributes = (tag: string) => {
  const attributes: Record<string, string> = {};
  const attrRegex = /([a-zA-Z_:][a-zA-Z0-9_:\-]*)\s*=\s*(["'])(.*?)\2/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(tag)) !== null) {
    attributes[match[1].toLowerCase()] = match[3];
  }
  return attributes;
};

type SrcsetCandidate = { url: string; score: number };

const pickSrcsetCandidate = (srcset: string) => {
  const parts = srcset.split(',');
  const candidates: SrcsetCandidate[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [url, descriptor] = trimmed.split(/\s+/, 2);
    let score = 0;
    if (descriptor?.endsWith('w')) {
      const width = Number(descriptor.slice(0, -1));
      score = Number.isFinite(width) ? width : 0;
    } else if (descriptor?.endsWith('x')) {
      const ratio = Number(descriptor.slice(0, -1));
      score = Number.isFinite(ratio) ? ratio * 1000 : 0;
    } else {
      score = 1;
    }
    candidates.push({ url, score });
  }
  if (candidates.length === 0) return undefined;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].url;
};

type DiscoveredMediaCandidate = {
  kind: 'image' | 'video';
  rawUrl: string;
  filenameHint?: string;
};

const extractImageUrls = (html: string) => {
  const tags = html.match(/<img\b[^>]*>/gi) ?? [];
  const urls: DiscoveredMediaCandidate[] = [];
  for (const tag of tags) {
    const attrs = parseAttributes(tag);
    const typeValue = (attrs.type || '').toLowerCase();
    const srcsetCandidate = attrs.srcset ? pickSrcsetCandidate(attrs.srcset) : undefined;
    const raw =
      srcsetCandidate ||
      attrs.src ||
      attrs['data-src'] ||
      attrs['data-lazy-src'] ||
      attrs['data-original'];
    if (!raw) continue;
    const looksLikeVideoSource =
      typeValue.startsWith('video/') || /\.(mp4|webm|mov|m4v|ogv|ogg)(\?|$)/i.test(raw);
    urls.push({
      kind: looksLikeVideoSource ? 'video' : 'image',
      rawUrl: raw,
    });
  }
  return urls;
};

const extractVideoUrls = (html: string) => {
  const candidates: DiscoveredMediaCandidate[] = [];
  const videoTags = html.match(/<video\b[^>]*>([\s\S]*?)<\/video>/gi) ?? [];
  for (const videoTag of videoTags) {
    const videoOpenTag = videoTag.match(/<video\b[^>]*>/i)?.[0] ?? '';
    const videoAttrs = parseAttributes(videoOpenTag);
    const filenameHint = videoAttrs['aria-label'] || videoAttrs.title || videoAttrs['data-filename'];
    const directVideoSrc =
      videoAttrs.src || videoAttrs['data-src'] || videoAttrs['data-original'] || videoAttrs.poster;
    if (directVideoSrc) {
      candidates.push({
        kind: 'video',
        rawUrl: directVideoSrc,
        filenameHint,
      });
    }

    const sourceTags = videoTag.match(/<source\b[^>]*>/gi) ?? [];
    for (const sourceTag of sourceTags) {
      const attrs = parseAttributes(sourceTag);
      const raw = attrs.src || (attrs.srcset ? pickSrcsetCandidate(attrs.srcset) : undefined);
      if (!raw) continue;
      candidates.push({
        kind: 'video',
        rawUrl: raw,
        filenameHint,
      });
    }
  }
  return candidates;
};

const getFilenameFromUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    const segments = parsed.pathname.split('/').filter(Boolean);
    return segments[segments.length - 1] || 'remote-image';
  } catch {
    return 'remote-image';
  }
};

const isAbsoluteHttpUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
};

const looksLikeRelativeUrl = (value: string) =>
  !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value) && !value.startsWith('//');

const resolveUrl = (value: string, baseUrl?: string) => {
  try {
    const resolved = baseUrl ? new URL(value, baseUrl) : new URL(value);
    if (!['http:', 'https:'].includes(resolved.protocol)) return undefined;
    resolved.hash = '';
    if (isPrivateHost(resolved.hostname)) return undefined;
    return resolved.toString();
  } catch {
    return undefined;
  }
};

type ResolvedMediaCandidate = {
  kind: 'image' | 'video';
  url: string;
  isBlob: boolean;
  filename: string;
};

const resolveMediaCandidate = (
  candidate: DiscoveredMediaCandidate,
  baseUrl?: string
): { candidate?: ResolvedMediaCandidate; skippedRelative: boolean } => {
  const raw = candidate.rawUrl.trim();
  if (!raw) return { skippedRelative: false };

  if (raw.startsWith('blob:')) {
    return {
      candidate: {
        kind: candidate.kind,
        url: raw,
        isBlob: true,
        filename: candidate.filenameHint || getFilenameFromUrl(raw),
      },
      skippedRelative: false,
    };
  }

  if (!baseUrl && !isAbsoluteHttpUrl(raw)) {
    return { skippedRelative: looksLikeRelativeUrl(raw) };
  }

  const resolved = resolveUrl(raw, baseUrl);
  if (!resolved) return { skippedRelative: false };
  return {
    candidate: {
      kind: candidate.kind,
      url: resolved,
      isBlob: false,
      filename: candidate.filenameHint || getFilenameFromUrl(resolved),
    },
    skippedRelative: false,
  };
};

const resolveHtmlBaseUrl = (html: string, sourceUrl?: string) => {
  const baseHref = extractBaseHref(html);
  if (baseHref) {
    try {
      return {
        baseHref,
        baseUrl: new URL(baseHref, sourceUrl || undefined).toString(),
      };
    } catch {
      return {
        baseHref,
        baseUrl: sourceUrl,
      };
    }
  }
  return {
    baseHref,
    baseUrl: sourceUrl,
  };
};

const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>
) => {
  const results: R[] = [];
  let index = 0;
  const run = async () => {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  };
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => run());
  await Promise.all(workers);
  return results;
};

export const discoverPageMediaFromHtml = async ({
  html,
  sourceUrl,
  smallAssetThresholdBytes,
  maxImages,
  includeUiChrome,
  includeSmallAssets,
  fetchHeadInfo,
}: DiscoverPageMediaParams) => {
  const { baseHref, baseUrl } = resolveHtmlBaseUrl(html, sourceUrl);
  const rawCandidates = [...extractImageUrls(html), ...extractVideoUrls(html)];
  const resolvedResults = rawCandidates.map((candidate) => resolveMediaCandidate(candidate, baseUrl));
  const skippedRelativeCount = resolvedResults.filter((result) => result.skippedRelative).length;
  const resolvedCandidates = resolvedResults
    .map((result) => result.candidate)
    .filter((candidate): candidate is ResolvedMediaCandidate => Boolean(candidate));

  const dedupedCandidates = Array.from(
    new Map(
      resolvedCandidates.map((candidate) => [
        `${candidate.kind}:${candidate.url}`,
        candidate,
      ])
    ).values()
  );

  const filteredCandidates = dedupedCandidates.filter(
    (candidate) =>
      (includeUiChrome || !looksLikeUiChromeAsset(candidate.url, candidate.filename)) &&
      !looksLikeTrackingOrUtilityAsset(candidate.url, candidate.filename) &&
      !looksLikeTinyTrackingPixel({
        url: candidate.url,
        filenameHint: candidate.filename,
      })
  );

  const imageCandidates = filteredCandidates.filter((candidate) => candidate.kind === 'image' && !candidate.isBlob);
  const videoCandidates = filteredCandidates.filter((candidate) => candidate.kind === 'video');

  const limitedImageCandidates =
    typeof maxImages === 'number' && maxImages > 0
      ? imageCandidates.slice(0, maxImages)
      : imageCandidates;

  const headInfos = await mapWithConcurrency(limitedImageCandidates, 6, async (candidate) => ({
    url: candidate.url,
    filename: candidate.filename,
    ...(await fetchHeadInfo(candidate.url)),
  }));

  const images = headInfos
    .map((info) => ({
      ...info,
      smallAssetReview: buildSmallAssetFileSizeReview(info.contentLength, smallAssetThresholdBytes),
    }))
    .filter((info) => {
      if (looksLikeTinyTrackingPixel({
        url: info.url,
        filenameHint: info.filename,
        contentLength: info.contentLength,
      })) {
        return false;
      }
      if (info.contentType && !info.contentType.startsWith('image/')) return false;
      if (info.smallAssetReview && !includeSmallAssets) return false;
      return true;
    })
    .map((info) => ({
      url: info.url,
      filename: info.filename || getFilenameFromUrl(info.url),
      contentType: info.contentType,
      contentLength: info.contentLength,
      smallAssetReview: info.smallAssetReview,
    }));

  const videos = videoCandidates.map((candidate) => ({
    kind: 'video' as const,
    url: candidate.url,
    filename: candidate.filename || getFilenameFromUrl(candidate.url),
    isBlob: candidate.isBlob,
    contentType: candidate.url.startsWith('blob:') ? undefined : 'video/unknown',
  }));

  const normalizedImages = images.map((image) => {
    const candidate = toImportCandidate({
      kind: 'image',
      url: image.url,
      filename: image.filename || getFilenameFromUrl(image.url),
      metadata: {
        fileSizeBytes: image.contentLength,
        contentType: image.contentType,
        sources: {
          fileSize: typeof image.contentLength === 'number' ? 'head' : undefined,
        },
      },
    });
    return {
      ...candidate,
      contentType: image.contentType,
      contentLength: image.contentLength,
      smallAssetReview: image.smallAssetReview,
    };
  });

  const normalizedVideos = videos.map((video) => {
    const candidate = toImportCandidate({
      kind: 'video',
      url: video.url,
      filename: video.filename || getFilenameFromUrl(video.url),
      isBlobSource: video.isBlob,
      metadata: {
        contentType: video.contentType,
      },
    });
    return {
      ...candidate,
      isBlob: video.isBlob,
      contentType: video.contentType,
    };
  });

  const media = [...normalizedImages, ...normalizedVideos];
  const relativeUrlWarning =
    skippedRelativeCount > 0 && !baseUrl
      ? `${skippedRelativeCount} relative media URL${skippedRelativeCount !== 1 ? 's were' : ' was'} skipped because the HTML file did not include a usable base URL.`
      : undefined;

  return {
    baseHref,
    baseUrl: baseUrl ?? null,
    skippedRelativeCount,
    relativeUrlWarning,
    images: normalizedImages,
    videos: normalizedVideos,
    media,
  };
};
