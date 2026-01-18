import { getCachedImages, getCachedImagesSync, CachedCloudflareImage } from './cloudflareImageCache';
import { normalizeOriginalUrl } from '@/utils/urlNormalization';

const normalize = (value?: string | null) => (value ?? '').trim().toLowerCase();

export interface DuplicateSummary {
  id: string;
  filename: string;
  folder?: string;
  uploaded: string;
  url?: string;
}

export const toDuplicateSummary = (image: CachedCloudflareImage): DuplicateSummary => ({
  id: image.id,
  filename: image.filename,
  folder: image.folder,
  uploaded: image.uploaded,
  url: image.variants?.[0]
});

export async function findDuplicatesByOriginalUrl(originalUrl: string, namespace?: string) {
  const normalized = normalizeOriginalUrl(originalUrl);
  if (!normalized) {
    return [];
  }
  const images = await getCachedImages();
  return images.filter((img) => {
    if (namespace && img.namespace !== namespace) {
      return false;
    }
    const existingNormalized =
      img.originalUrlNormalized ?? normalizeOriginalUrl(img.originalUrl);
    return existingNormalized === normalized;
  });
}

const normalizeHash = (value?: string | null) => {
  const trimmed = (value ?? '').trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(trimmed) ? trimmed : undefined;
};

/**
 * Find duplicates by content hash.
 * CRITICAL: This uses BOTH the live in-memory cache AND the async-fetched cache
 * to ensure we catch duplicates even if the cache is being refreshed.
 * This prevents race conditions where two sequential uploads both pass the check.
 */
export async function findDuplicatesByContentHash(contentHash: string, namespace?: string) {
  const normalized = normalizeHash(contentHash);
  if (!normalized) {
    return [];
  }

  // First check the synchronous in-memory cache directly
  // This catches images uploaded in the current session that haven't been persisted yet
  const memoryImages = getCachedImagesSync();
  const memoryMatches = memoryImages.filter((img) => {
    if (namespace && img.namespace !== namespace) {
      return false;
    }
    return normalizeHash(img.contentHash) === normalized;
  });

  if (memoryMatches.length > 0) {
    console.log('[duplicate] Found match in memory cache:', memoryMatches.map(m => m.id));
    return memoryMatches;
  }

  // Also check the async cache in case the memory cache is empty/cold
  const asyncImages = await getCachedImages();
  const asyncMatches = asyncImages.filter((img) => {
    if (namespace && img.namespace !== namespace) {
      return false;
    }
    return normalizeHash(img.contentHash) === normalized;
  });

  if (asyncMatches.length > 0) {
    console.log('[duplicate] Found match in async cache:', asyncMatches.map(m => m.id));
  }

  return asyncMatches;
}
