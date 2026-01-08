import { getCachedImages, CachedCloudflareImage } from './cloudflareImageCache';
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

export async function findDuplicatesByContentHash(contentHash: string, namespace?: string) {
  const normalizeHash = (value?: string | null) => {
    const trimmed = (value ?? '').trim().toLowerCase();
    return /^[a-f0-9]{64}$/.test(trimmed) ? trimmed : undefined;
  };

  const normalized = normalizeHash(contentHash);
  if (!normalized) {
    return [];
  }
  const images = await getCachedImages();
  return images.filter((img) => {
    if (namespace && img.namespace !== namespace) {
      return false;
    }
    return normalizeHash(img.contentHash) === normalized;
  });
}
