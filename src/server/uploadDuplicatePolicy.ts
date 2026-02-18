import type { CachedCloudflareImage } from '@/server/cloudflareImageCache';
import { findDuplicatesByContentHash, findDuplicatesByOriginalUrl } from '@/server/duplicateDetector';

type DuplicateLocation = Array<string | null>;

export type OriginalUrlReuseWarning = {
  normalizedOriginalUrl: string;
  matches: CachedCloudflareImage[];
  duplicateIds: string[];
  duplicateFolders: DuplicateLocation;
};

export type UploadDeduplicationResult = {
  originalUrlWarning?: OriginalUrlReuseWarning;
  contentHashDuplicates: CachedCloudflareImage[];
};

const summarizeDuplicateMatches = (matches: CachedCloudflareImage[]) => ({
  duplicateIds: matches.map((match) => match.id),
  duplicateFolders: matches.map((match) => match.folder || null),
});

const buildOriginalUrlReuseWarning = (
  normalizedOriginalUrl: string,
  matches: CachedCloudflareImage[]
): OriginalUrlReuseWarning => ({
  normalizedOriginalUrl,
  matches,
  ...summarizeDuplicateMatches(matches),
});

export async function evaluateUploadDeduplicationPolicy(params: {
  contentHash: string;
  normalizedOriginalUrl?: string;
  namespace?: string;
}): Promise<UploadDeduplicationResult> {
  const { contentHash, normalizedOriginalUrl, namespace } = params;

  const originalUrlMatches = normalizedOriginalUrl
    ? await findDuplicatesByOriginalUrl(normalizedOriginalUrl, namespace)
    : [];
  const contentHashDuplicates = await findDuplicatesByContentHash(contentHash, namespace);

  return {
    originalUrlWarning: originalUrlMatches.length
      ? buildOriginalUrlReuseWarning(normalizedOriginalUrl!, originalUrlMatches)
      : undefined,
    contentHashDuplicates,
  };
}

export function logOriginalUrlReuseWarning(params: {
  logScope: string;
  originalUrl?: string;
  warning: OriginalUrlReuseWarning;
}): void {
  const { logScope, originalUrl, warning } = params;
  console.warn(`[${logScope}] Original URL already exists (warning only)`, {
    originalUrl,
    normalizedOriginalUrl: warning.normalizedOriginalUrl,
    duplicateIds: warning.duplicateIds,
    folders: warning.duplicateFolders,
  });
}

export function logContentHashDuplicate(params: {
  logScope: string;
  contentHash: string;
  duplicates: CachedCloudflareImage[];
}): void {
  const { logScope, contentHash, duplicates } = params;
  const summary = summarizeDuplicateMatches(duplicates);
  console.warn(`[${logScope}] Duplicate content hash detected`, {
    contentHash,
    duplicateIds: summary.duplicateIds,
    folders: summary.duplicateFolders,
  });
}
