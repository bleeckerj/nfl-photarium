import { PHOTO_URL_KEYS } from './constants.mjs';
import { getContentTypeExtension, inferExtensionFromUrl, uniqueStrings } from './util.mjs';

export function chooseBestPhotoSource(listPhoto, sizes = []) {
  const listCandidates = PHOTO_URL_KEYS
    .filter((key) => listPhoto?.urlMap?.[key])
    .map((key) => ({
      source: listPhoto.urlMap[key],
      label: key.replace(/^url_/, '').toUpperCase(),
      width: 0,
      height: 0,
      isOriginal: key === 'url_o',
    }));

  const sizeCandidates = (sizes || [])
    .filter((entry) => entry && entry.source && entry.media !== 'video')
    .map((entry) => ({
      source: entry.source,
      label: entry.label,
      width: Number(entry.width || 0),
      height: Number(entry.height || 0),
      isOriginal: String(entry.label || '').toLowerCase().includes('original'),
    }));

  const candidates = [...listCandidates, ...sizeCandidates];
  if (candidates.length === 0) {
    return null;
  }

  const originals = candidates.filter((candidate) => candidate.isOriginal);
  if (originals.length > 0) {
    const original = originals[0];
    return {
      url: original.source,
      preferredSize: original.label || 'Original',
      originalAvailable: true,
      width: original.width,
      height: original.height,
    };
  }

  const fallback = [...candidates].sort((left, right) => {
    const areaA = Number(left.width || 0) * Number(left.height || 0);
    const areaB = Number(right.width || 0) * Number(right.height || 0);
    return areaB - areaA;
  })[0];

  return {
    url: fallback.source,
    preferredSize: fallback.label || 'Best Available',
    originalAvailable: false,
    width: fallback.width,
    height: fallback.height,
  };
}

export function chooseBestVideoSource(sizes = []) {
  const candidates = (sizes || [])
    .filter((entry) => entry?.source && entry.media === 'video')
    .map((entry) => ({
      source: entry.source,
      label: entry.label,
      width: Number(entry.width || 0),
      height: Number(entry.height || 0),
      isOriginal: String(entry.label || '').toLowerCase().includes('original'),
    }));

  if (candidates.length === 0) return null;
  const selected = candidates.find((candidate) => candidate.isOriginal)
    || [...candidates].sort((left, right) => {
      const areaA = left.width * left.height;
      const areaB = right.width * right.height;
      return areaB - areaA;
    })[0];

  return {
    url: selected.source,
    preferredSize: selected.label || 'Best Available',
    originalAvailable: selected.isOriginal,
    width: selected.width,
    height: selected.height,
  };
}

export function parseFlickrTags(infoTags, listTags) {
  const byInfo = Array.isArray(infoTags) ? infoTags : [];
  if (byInfo.length > 0) {
    return uniqueStrings(byInfo.map((tag) => String(tag).trim().toLowerCase()));
  }
  return uniqueStrings(
    String(listTags || '')
      .split(' ')
      .map((tag) => tag.trim().toLowerCase())
  );
}

export function determineFolder({ selector, selectedAlbumTitle, albumTitles }) {
  if (selector === 'album' && selectedAlbumTitle) return selectedAlbumTitle;
  const cleanAlbums = uniqueStrings(albumTitles || []);
  if (cleanAlbums.length === 1) return cleanAlbums[0];
  if (cleanAlbums.length > 1) return [...cleanAlbums].sort((left, right) => left.localeCompare(right))[0];
  return undefined;
}

export function buildPhotariumMetadata({
  selector,
  namespace,
  selectedAlbumTitle,
  listPhoto,
  info,
  albumTitles,
  sourceUrl,
}) {
  const tags = uniqueStrings(['flickr', ...parseFlickrTags(info.tags, listPhoto.tags)]);
  const folder = determineFolder({
    selector,
    selectedAlbumTitle,
    albumTitles,
  });
  const displayName = info.title || listPhoto.title || `flickr-${listPhoto.id}`;
  const description = info.description || undefined;
  const permalink = info.urls?.[0] || sourceUrl;
  return {
    namespace,
    folder,
    tags,
    displayName,
    description,
    sourceUrl: permalink,
  };
}

export function buildFlickrExtras({
  authProfile,
  listPhoto,
  info,
  albumTitles,
  source,
  originalUrl,
  downloadedContentHash,
}) {
  const visibility = info.visibility.public
    ? 'public'
    : info.visibility.friend && info.visibility.family
      ? 'friends-family'
      : info.visibility.friend
        ? 'friends'
        : info.visibility.family
          ? 'family'
          : 'private';

  return {
    flickrSource: {
      photoId: listPhoto.id,
      ownerNsid: authProfile.userId,
      username: authProfile.username,
      permalink: info.urls?.[0] || undefined,
      visibility,
      lastUpdate: info.lastUpdate || listPhoto.lastUpdate || undefined,
      takenAt: info.takenAt || listPhoto.dateTaken || undefined,
      albumTitles: uniqueStrings(albumTitles || []),
      tagList: parseFlickrTags(info.tags, listPhoto.tags),
      preferredSize: source?.preferredSize,
      selectedSourceUrl: originalUrl || undefined,
      originalAvailable: source?.originalAvailable === true,
      originalFormat: listPhoto.originalFormat || undefined,
      downloadedContentHash: downloadedContentHash || undefined,
    },
  };
}

export function inferDownloadFileName(listPhoto, sourceUrl, contentType) {
  const base = listPhoto.title
    ? listPhoto.title.trim().replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    : `flickr-${listPhoto.id}`;
  const ext = getContentTypeExtension(contentType) || inferExtensionFromUrl(sourceUrl) || (listPhoto.originalFormat ? `.${listPhoto.originalFormat}` : '') || '.jpg';
  return `${base || `flickr-${listPhoto.id}`}${ext.startsWith('.') ? ext : `.${ext}`}`;
}

export function normalizeAlbumTitles(contexts) {
  return uniqueStrings((contexts || []).map((context) => context.title).filter(Boolean));
}

export function normalizePhotoPayload(photo) {
  return {
    ...photo,
    id: String(photo.id),
    title: String(photo.title || ''),
  };
}
