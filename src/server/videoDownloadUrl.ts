type VideoDownloadLike = {
  streamUid?: string;
  playbackUrl?: string;
  hlsUrl?: string;
  thumbnailUrl?: string;
  previewUrl?: string;
  sourceUrl?: string;
  originalUrl?: string;
};

const normalizeUrl = (value?: string) => {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.toString();
  } catch {
    return '';
  }
};

const extractLikelyStreamUid = (value?: string) => {
  const trimmed = value?.trim();
  if (!trimmed) return '';

  // Typical Cloudflare stream UIDs are URL-safe tokens; keep this permissive
  // while avoiding obvious path fragments.
  const isUidToken = (token: string) => /^[A-Za-z0-9_-]{8,}$/.test(token);

  if (!trimmed.includes('/')) {
    return isUidToken(trimmed) ? trimmed : '';
  }

  const asUrl = normalizeUrl(trimmed);
  if (asUrl) {
    try {
      const parts = new URL(asUrl).pathname.split('/').filter(Boolean);
      const candidate = parts[0] || '';
      return isUidToken(candidate) ? candidate : '';
    } catch {
      return '';
    }
  }

  const pathCandidate = trimmed.split('/').filter(Boolean)[0] || '';
  return isUidToken(pathCandidate) ? pathCandidate : '';
};

const toCloudflareStreamDownloadUrl = (value?: string) => {
  const normalized = normalizeUrl(value);
  if (!normalized) return '';

  if (/\/downloads\/default\.mp4(?:\?.*)?$/i.test(normalized)) {
    return normalized;
  }
  if (normalized.includes('/manifest/video.m3u8')) {
    return normalized.replace('/manifest/video.m3u8', '/downloads/default.mp4');
  }
  if (normalized.endsWith('/iframe')) {
    return normalized.replace(/\/iframe$/, '/downloads/default.mp4');
  }
  if (normalized.endsWith('/watch')) {
    return normalized.replace(/\/watch$/, '/downloads/default.mp4');
  }

  // Best effort for URL forms that carry the UID but use other paths.
  try {
    const parsed = new URL(normalized);
    const streamUid = extractLikelyStreamUid(normalized);
    if (!streamUid) return '';
    return `${parsed.origin}/${encodeURIComponent(streamUid)}/downloads/default.mp4`;
  } catch {
    return '';
  }
};

const isLikelyDownloadableVideoUrl = (value?: string) => {
  const normalized = normalizeUrl(value);
  if (!normalized) return false;
  return /(\.(mp4|mov|webm|m4v|m3u8)(\?.*)?$)|([?&](download|dl|filename)=)|\/downloads\/|([?&](response-content-type|content-type|mime)=video%2F)/i.test(normalized);
};

const normalizeOrigin = (value?: string) => {
  const normalized = normalizeUrl(value);
  if (!normalized) return '';
  try {
    return new URL(normalized).origin;
  } catch {
    return '';
  }
};

const getConfiguredVideoDeliveryBase = () => {
  const normalized = normalizeUrl(
    process.env.CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN
      ? `https://${process.env.CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN}.cloudflarestream.com`
      : 'https://videodelivery.net'
  );
  if (!normalized) return 'https://videodelivery.net';
  return normalized.replace(/\/+$/, '');
};

const getVideoDeliveryBases = (video: VideoDownloadLike) => {
  const candidates = [
    normalizeOrigin(video.thumbnailUrl),
    normalizeOrigin(video.previewUrl),
    normalizeOrigin(video.playbackUrl),
    normalizeOrigin(video.hlsUrl),
    getConfiguredVideoDeliveryBase(),
  ].filter(Boolean);

  const customerBases = candidates.filter((value) => /\.cloudflarestream\.com$/i.test(new URL(value).host));
  const genericBases = candidates.filter((value) => !/\.cloudflarestream\.com$/i.test(new URL(value).host));
  return [...new Set([...customerBases, ...genericBases])];
};

const buildStreamUidDownloadUrl = (streamUid?: string, base?: string) => {
  const normalizedUid = extractLikelyStreamUid(streamUid);
  if (!normalizedUid) return '';
  const deliveryBase = (base || getConfiguredVideoDeliveryBase()).replace(/\/+$/, '');
  return `${deliveryBase}/${encodeURIComponent(normalizedUid)}/downloads/default.mp4`;
};

const toSafeDirectVideoCandidate = (value?: string) => {
  const normalized = normalizeUrl(value);
  if (!normalized) return '';
  if (!isLikelyDownloadableVideoUrl(normalized)) return '';
  return normalized;
};

export const resolveVideoDownloadUrls = (video: VideoDownloadLike) => {
  const candidates = [
    toCloudflareStreamDownloadUrl(video.hlsUrl),
    toCloudflareStreamDownloadUrl(video.playbackUrl),
    ...getVideoDeliveryBases(video).map((base) => buildStreamUidDownloadUrl(video.streamUid, base)),
    toSafeDirectVideoCandidate(video.sourceUrl),
    toSafeDirectVideoCandidate(video.originalUrl),
  ];

  return candidates.filter((value, index, array): value is string => Boolean(value) && array.indexOf(value) === index);
};

export const resolveVideoDownloadUrl = (video: VideoDownloadLike) => {
  return resolveVideoDownloadUrls(video)[0] || '';
};
