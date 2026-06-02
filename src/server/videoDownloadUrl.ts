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

const isLikelyDownloadableVideoUrl = (value?: string) => {
  const normalized = normalizeUrl(value);
  if (!normalized) return false;
  return /(\.(mp4|mov|webm|m4v|m3u8)(\?.*)?$)|([?&](download|dl|filename)=)|\/downloads\/|([?&](response-content-type|content-type|mime)=video%2F)/i.test(normalized);
};

const toSafeDirectVideoCandidate = (value?: string) => {
  const normalized = normalizeUrl(value);
  if (!normalized) return '';
  if (!isLikelyDownloadableVideoUrl(normalized)) return '';
  return normalized;
};

export const resolveVideoDownloadUrls = (video: VideoDownloadLike) => {
  const candidates = [
    toSafeDirectVideoCandidate(video.playbackUrl),
    toSafeDirectVideoCandidate(video.previewUrl),
    toSafeDirectVideoCandidate(video.sourceUrl),
    toSafeDirectVideoCandidate(video.originalUrl),
  ];

  return candidates.filter((value, index, array): value is string => Boolean(value) && array.indexOf(value) === index);
};

export const resolveVideoDownloadUrl = (video: VideoDownloadLike) => {
  return resolveVideoDownloadUrls(video)[0] || '';
};
