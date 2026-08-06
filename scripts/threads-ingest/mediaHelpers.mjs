export function parseThreadsPostUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'www.threads.com' && parsed.hostname !== 'threads.com') return null;
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length < 3 || (parts[1] || '').toLowerCase() !== 'post') return null;
    const usernameFromPath = parts[0]?.startsWith('@') ? parts[0].slice(1) : null;
    const shortcode = parts[2] || null;
    return shortcode ? { usernameFromPath, shortcode, canonicalUrl: `https://www.threads.com/@${usernameFromPath}/post/${shortcode}` } : null;
  } catch {
    return { username: '', shortcode: '' };
  }
}

export function contentTypeToExt(contentType) {
  const normalized = String(contentType || '').toLowerCase();
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return '.jpg';
  if (normalized.includes('png')) return '.png';
  if (normalized.includes('webp')) return '.webp';
  if (normalized.includes('gif')) return '.gif';
  if (normalized.includes('mp4')) return '.mp4';
  if (normalized.includes('webm')) return '.webm';
  if (normalized.includes('quicktime')) return '.mov';
  return '.bin';
}

export function normalizeMediaUrlKey(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.searchParams.delete('bytestart');
    parsed.searchParams.delete('byteend');
    parsed.searchParams.delete('range');
    parsed.searchParams.sort();
    return `${parsed.origin}${parsed.pathname}?${parsed.searchParams.toString()}`;
  } catch {
    return String(url || '').trim();
  }
}

export function scoreVideoUrl(url) {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase();
    const hasVideoExt = /\.(mp4|webm|mov|m4v|m3u8)(\?|$)/.test(pathname);
    const hasByteRangeHint = parsed.searchParams.has('bytestart') || parsed.searchParams.has('byteend') || parsed.searchParams.has('range');
    let score = 0;
    if (hasVideoExt) score += 20;
    if (!hasByteRangeHint) score += 60;
    if (hasByteRangeHint) score -= 40;
    if (parsed.searchParams.get('bytestart') === '0') score += 5;
    return score + Math.min(10, pathname.length / 50);
  } catch { return -100; }
}

export function reduceVideoUrlsForUpload(videoUrls) {
  if (!Array.isArray(videoUrls) || videoUrls.length <= 1) return Array.isArray(videoUrls) ? videoUrls : [];
  const bestByKey = new Map();
  for (const videoUrl of videoUrls) {
    if (typeof videoUrl !== 'string' || !videoUrl.startsWith('http')) continue;
    const key = normalizeMediaUrlKey(videoUrl);
    const score = scoreVideoUrl(videoUrl);
    const current = bestByKey.get(key);
    if (!current || score > current.score) bestByKey.set(key, { videoUrl, score });
  }
  const reduced = [...bestByKey.values()].sort((a, b) => b.score - a.score).map((entry) => entry.videoUrl);
  const preferred = reduced.filter((videoUrl) => scoreVideoUrl(videoUrl) >= 0);
  return preferred.length > 0 ? preferred : reduced;
}

export function buildUploadTags(ownerUsername) {
  const username = String(ownerUsername || '').trim();
  const tags = ['threads'];
  if (username) { tags.push(username); tags.push(`threads_profile:${username}`); }
  return [...new Set(tags)];
}
