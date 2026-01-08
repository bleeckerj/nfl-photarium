import { cleanString, parseCloudflareMetadata } from '@/utils/cloudflareMetadata';
import { normalizeOriginalUrl } from '@/utils/urlNormalization';

interface CloudflareImageApiResponse {
  id: string;
  filename?: string;
  uploaded: string;
  variants: string[];
  meta?: unknown;
}

export interface CachedCloudflareImage {
  id: string;
  filename: string;
  uploaded: string;
  variants: string[];
  folder?: string;
  tags: string[];
  description?: string;
  originalUrl?: string;
  originalUrlNormalized?: string;
  sourceUrl?: string;
  sourceUrlNormalized?: string;
  namespace?: string;
  contentHash?: string;
  altTag?: string;
  displayName?: string;
  exif?: Record<string, string | number>;
  parentId?: string;
  linkedAssetId?: string;
  variationSort?: number;
}

interface CacheState {
  images: CachedCloudflareImage[];
  map: Map<string, CachedCloudflareImage>;
  lastFetched: number;
  inflight: Promise<CachedCloudflareImage[]> | null;
}

const GLOBAL_CACHE_KEY = Symbol.for('cloudflare.image.cache');
const globalObject = globalThis as typeof globalThis & {
  [GLOBAL_CACHE_KEY]?: CacheState;
};

const defaultState: CacheState = {
  images: [],
  map: new Map(),
  lastFetched: 0,
  inflight: null
};

const cacheState: CacheState = globalObject[GLOBAL_CACHE_KEY] ?? defaultState;
if (!globalObject[GLOBAL_CACHE_KEY]) {
  globalObject[GLOBAL_CACHE_KEY] = cacheState;
}

const CACHE_TTL_MS = Number(process.env.CLOUDFLARE_CACHE_TTL_MS ?? 5 * 60 * 1000);
const PAGE_SIZE = Math.min(
  100,
  Math.max(10, Number(process.env.CLOUDFLARE_CACHE_PAGE_SIZE ?? 100))
);
const MAX_PAGES = (() => {
  const value = Number(process.env.CLOUDFLARE_CACHE_MAX_PAGES);
  return Number.isFinite(value) && value > 0 ? value : undefined;
})();

const transformImage = (image: CloudflareImageApiResponse): CachedCloudflareImage => {
  const parsedMeta = parseCloudflareMetadata(image.meta);
  const cleanFolder =
    parsedMeta.folder && parsedMeta.folder !== 'undefined' ? parsedMeta.folder : undefined;
  const cleanTags = Array.isArray(parsedMeta.tags)
    ? parsedMeta.tags.filter((tag): tag is string => Boolean(tag) && tag !== 'undefined')
    : [];
  const cleanDescription =
    parsedMeta.description && parsedMeta.description !== 'undefined'
      ? parsedMeta.description
      : undefined;
  const cleanOriginalUrl =
    parsedMeta.originalUrl && parsedMeta.originalUrl !== 'undefined'
      ? parsedMeta.originalUrl
      : undefined;
  const cleanOriginalUrlNormalized =
    parsedMeta.originalUrlNormalized && parsedMeta.originalUrlNormalized !== 'undefined'
      ? parsedMeta.originalUrlNormalized
      : undefined;
  const normalizedOriginalUrl =
    cleanOriginalUrlNormalized ?? normalizeOriginalUrl(cleanOriginalUrl);
  const cleanSourceUrl =
    parsedMeta.sourceUrl && parsedMeta.sourceUrl !== 'undefined'
      ? parsedMeta.sourceUrl
      : undefined;
  const cleanSourceUrlNormalized =
    parsedMeta.sourceUrlNormalized && parsedMeta.sourceUrlNormalized !== 'undefined'
      ? parsedMeta.sourceUrlNormalized
      : undefined;
  const normalizedSourceUrl =
    cleanSourceUrlNormalized ?? normalizeOriginalUrl(cleanSourceUrl);
  const cleanNamespace =
    parsedMeta.namespace && parsedMeta.namespace !== 'undefined'
      ? parsedMeta.namespace
      : undefined;
  const cleanAltTag =
    parsedMeta.altTag && parsedMeta.altTag !== 'undefined' ? parsedMeta.altTag : undefined;
  const displayName =
    parsedMeta.displayName && parsedMeta.displayName !== 'undefined'
      ? parsedMeta.displayName
      : undefined;
  const cleanContentHash =
    parsedMeta.contentHash && parsedMeta.contentHash !== 'undefined'
      ? parsedMeta.contentHash
      : undefined;
  const cleanExif =
    parsedMeta.exif && typeof parsedMeta.exif === 'object' && !Array.isArray(parsedMeta.exif)
      ? (parsedMeta.exif as Record<string, string | number>)
      : undefined;
  const cleanVariationSort = (() => {
    if (typeof parsedMeta.variationSort === 'number' && Number.isFinite(parsedMeta.variationSort)) {
      return parsedMeta.variationSort;
    }
    if (typeof parsedMeta.variationSort === 'string') {
      const parsed = Number(parsedMeta.variationSort);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  })();
  const parentId = cleanString(parsedMeta.variationParentId);
  const linkedAssetId = cleanString(parsedMeta.linkedAssetId);

  return {
    id: image.id,
    filename: image.filename || parsedMeta.filename || 'Unknown',
    uploaded: image.uploaded,
    variants: image.variants,
    folder: cleanFolder,
    tags: cleanTags,
    description: cleanDescription,
    originalUrl: cleanOriginalUrl,
    originalUrlNormalized: normalizedOriginalUrl,
    sourceUrl: cleanSourceUrl,
    sourceUrlNormalized: normalizedSourceUrl,
    namespace: cleanNamespace,
    contentHash: cleanContentHash,
    altTag: cleanAltTag,
    displayName: displayName ?? image.filename || parsedMeta.filename || undefined,
    exif: cleanExif,
    variationSort: cleanVariationSort,
    parentId,
    linkedAssetId
  };
};

const fetchPage = async (
  accountId: string,
  apiToken: string,
  page: number
): Promise<CloudflareImageApiResponse[]> => {
  const params = new URLSearchParams({
    per_page: String(PAGE_SIZE),
    page: String(page)
  });

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${apiToken}`
      },
      cache: 'no-store'
    }
  );

  const json = await response.json();
  if (!response.ok) {
    const errorMessage =
      json?.errors?.[0]?.message || 'Failed to fetch Cloudflare Images page.';
    throw new Error(errorMessage);
  }

  return Array.isArray(json?.result?.images) ? json.result.images : [];
};

const fetchAllImages = async (): Promise<CachedCloudflareImage[]> => {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !apiToken) {
    throw new Error('Cloudflare credentials not configured');
  }

  const collected: CloudflareImageApiResponse[] = [];
  let page = 1;

  while (true) {
    const images = await fetchPage(accountId, apiToken, page);
    collected.push(...images);
    if (images.length < PAGE_SIZE) {
      break;
    }
    page += 1;
    if (MAX_PAGES && page > MAX_PAGES) {
      console.warn(
        `Reached CLOUDFLARE_CACHE_MAX_PAGES (${MAX_PAGES}). Results may be incomplete.`
      );
      break;
    }
  }

  return collected.map(transformImage);
};

const shouldUseCache = (forceRefresh?: boolean) => {
  if (forceRefresh) return false;
  if (!cacheState.images.length) return false;
  return Date.now() - cacheState.lastFetched < CACHE_TTL_MS;
};

const rebuildState = (images: CachedCloudflareImage[]) => {
  cacheState.images = images;
  cacheState.map = new Map(images.map(image => [image.id, image]));
  cacheState.lastFetched = Date.now();
};

export const getCachedImages = async (forceRefresh = false) => {
  if (shouldUseCache(forceRefresh)) {
    return cacheState.images;
  }

  if (cacheState.inflight) {
    return cacheState.inflight;
  }

  const inflight = fetchAllImages()
    .then(images => {
      rebuildState(images);
      cacheState.inflight = null;
      return cacheState.images;
    })
    .catch(error => {
      cacheState.inflight = null;
      if (cacheState.images.length) {
        console.warn('Falling back to existing image cache after fetch failure:', error);
        return cacheState.images;
      }
      throw error;
    });

  cacheState.inflight = inflight;
  return inflight;
};

export const getCachedImage = async (id: string) => {
  if (cacheState.map.has(id)) {
    return cacheState.map.get(id);
  }
  const images = await getCachedImages();
  return images.find(image => image.id === id);
};

export const refreshCloudflareImageCache = async () => {
  return getCachedImages(true);
};

export const upsertCachedImage = (image: CachedCloudflareImage) => {
  cacheState.map.set(image.id, image);
  const index = cacheState.images.findIndex(item => item.id === image.id);
  if (index >= 0) {
    cacheState.images[index] = image;
  } else {
    cacheState.images.unshift(image);
  }
  cacheState.lastFetched = Date.now();
};

export const removeCachedImage = (id: string) => {
  cacheState.map.delete(id);
  cacheState.images = cacheState.images.filter(image => image.id !== id);
  cacheState.lastFetched = Date.now();
};

export const transformApiImageToCached = (image: CloudflareImageApiResponse) =>
  transformImage(image);

export const getCacheStats = () => ({
  count: cacheState.images.length,
  lastFetched: cacheState.lastFetched,
  ttlMs: CACHE_TTL_MS
});
