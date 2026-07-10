import { FLICKR_EXTRAS, PHOTO_URL_KEYS } from './constants.mjs';
import { signedFlickrRestCall } from './oauth.mjs';

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeAlbumShape(set) {
  return {
    id: String(set.id),
    title: set.title?._content || set.title || '',
    photos: Number(set.photos || 0),
    videos: Number(set.videos || 0),
    countViews: Number(set.count_views || 0),
  };
}

function normalizeListPhoto(photo) {
  return {
    id: String(photo.id),
    title: photo.title?._content || photo.title || '',
    media: String(photo.media || 'photo'),
    lastUpdate: String(photo.lastupdate || photo.last_update || ''),
    dateTaken: String(photo.datetaken || photo.date_taken || ''),
    dateUpload: String(photo.dateupload || photo.date_upload || ''),
    tags: String(photo.tags || ''),
    pathAlias: photo.pathalias || photo.path_alias || '',
    originalFormat: photo.originalformat || photo.original_format || '',
    urlMap: Object.fromEntries(
      PHOTO_URL_KEYS
        .filter((key) => typeof photo[key] === 'string' && photo[key])
        .map((key) => [key, photo[key]])
    ),
    raw: photo,
  };
}

function normalizePhotoInfo(photo) {
  const visibility = photo.visibility || {};
  const tags = asArray(photo.tags?.tag).map((tag) => tag.raw || tag._content || '').filter(Boolean);
  return {
    id: String(photo.id),
    secret: photo.secret || '',
    title: photo.title?._content || '',
    description: photo.description?._content || '',
    pathAlias: photo.pathalias || '',
    visibility: {
      public: visibility.ispublic === 1 || visibility.ispublic === '1',
      friend: visibility.isfriend === 1 || visibility.isfriend === '1',
      family: visibility.isfamily === 1 || visibility.isfamily === '1',
    },
    takenAt: photo.dates?.taken || '',
    lastUpdate: String(photo.dates?.lastupdate || ''),
    tags,
    media: String(photo.media || 'photo'),
    urls: asArray(photo.urls?.url).map((entry) => entry._content).filter(Boolean),
  };
}

function normalizeSizes(sizesPayload) {
  return asArray(sizesPayload?.size).map((size) => ({
    label: String(size.label || ''),
    width: Number(size.width || 0),
    height: Number(size.height || 0),
    source: String(size.source || ''),
    media: String(size.media || 'photo'),
  }));
}

export function createFlickrClient(auth) {
  const baseAuth = {
    apiKey: auth.apiKey,
    apiSecret: auth.apiSecret,
    accessToken: auth.oauthToken,
    accessTokenSecret: auth.oauthTokenSecret,
  };

  async function call(method, params = {}) {
    return signedFlickrRestCall({
      ...baseAuth,
      method,
      params,
    });
  }

  return {
    async testLogin() {
      const payload = await call('flickr.test.login');
      return {
        userId: payload.user?.id || payload.user?.nsid || '',
        username: payload.user?.username?._content || payload.user?.username || '',
      };
    },

    async listAlbums(userId) {
      let page = 1;
      const albums = [];
      while (true) {
        const payload = await call('flickr.photosets.getList', {
          user_id: userId,
          page,
          per_page: 500,
        });
        const photosets = payload.photosets || {};
        albums.push(...asArray(photosets.photoset).map(normalizeAlbumShape));
        if (page >= Number(photosets.pages || page)) break;
        page += 1;
      }
      return albums;
    },

    async *listAlbumPhotos(photosetId) {
      let page = 1;
      while (true) {
        const payload = await call('flickr.photosets.getPhotos', {
          photoset_id: photosetId,
          page,
          per_page: 500,
          extras: FLICKR_EXTRAS,
        });
        const photoset = payload.photoset || {};
        const items = asArray(photoset.photo).map(normalizeListPhoto);
        yield { page, totalPages: Number(photoset.pages || page), items };
        if (page >= Number(photoset.pages || page)) break;
        page += 1;
      }
    },

    async *listAllUserPhotos(userId) {
      let page = 1;
      while (true) {
        const payload = await call('flickr.people.getPhotos', {
          user_id: userId,
          page,
          per_page: 500,
          extras: FLICKR_EXTRAS,
        });
        const photos = payload.photos || {};
        const items = asArray(photos.photo).map(normalizeListPhoto);
        yield {
          page,
          totalPages: Number(photos.pages || page),
          totalItems: Number(photos.total || 0),
          items,
        };
        if (page >= Number(photos.pages || page)) break;
        page += 1;
      }
    },

    async *searchUserPhotosByTags(userId, tags, tagMode) {
      let page = 1;
      while (true) {
        const payload = await call('flickr.photos.search', {
          user_id: userId,
          page,
          per_page: 500,
          tags: tags.join(','),
          tag_mode: tagMode,
          extras: FLICKR_EXTRAS,
        });
        const photos = payload.photos || {};
        const items = asArray(photos.photo).map(normalizeListPhoto);
        yield { page, totalPages: Number(photos.pages || page), items };
        if (page >= Number(photos.pages || page)) break;
        page += 1;
      }
    },

    async getPhotoInfo(photoId) {
      const payload = await call('flickr.photos.getInfo', { photo_id: photoId });
      return normalizePhotoInfo(payload.photo || {});
    },

    async getPhotoContexts(photoId) {
      const payload = await call('flickr.photos.getAllContexts', { photo_id: photoId });
      return asArray(payload.set).map((set) => ({
        id: String(set.id),
        title: set.title || '',
      }));
    },

    async getPhotoSizes(photoId) {
      const payload = await call('flickr.photos.getSizes', { photo_id: photoId });
      return normalizeSizes(payload.sizes);
    },
  };
}

export function resolveAlbumsBySelector(albums, requestedTitles, requestedIds) {
  const matched = [];
  const missing = [];
  const duplicateTitles = [];

  requestedIds.forEach((id) => {
    const album = albums.find((candidate) => candidate.id === id);
    if (album) matched.push(album);
    else missing.push(`album-id:${id}`);
  });

  requestedTitles.forEach((title) => {
    const matches = albums.filter((candidate) => candidate.title.trim().toLowerCase() === title.trim().toLowerCase());
    if (matches.length === 1) matched.push(matches[0]);
    else if (matches.length === 0) missing.push(`album:${title}`);
    else duplicateTitles.push(title);
  });

  return {
    matched: Array.from(new Map(matched.map((album) => [album.id, album])).values()),
    missing,
    duplicateTitles,
  };
}
