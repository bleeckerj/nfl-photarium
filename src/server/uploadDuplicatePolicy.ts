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
  crossNamespaceContentHashMatches: CachedCloudflareImage[];
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
  const { contentHash, normalizedOriginalUrl } = params;
  const trimmedNamespace = typeof params.namespace === 'string' ? params.namespace.trim() : '';
  const targetNamespace =
    trimmedNamespace &&
    trimmedNamespace !== '__all__' &&
    trimmedNamespace !== '__none__' &&
    trimmedNamespace !== 'undefined'
      ? trimmedNamespace
      : undefined;

  const originalUrlMatches = normalizedOriginalUrl
    ? await findDuplicatesByOriginalUrl(normalizedOriginalUrl, targetNamespace)
    : [];
  // Hard-block duplicates only within the target namespace.
  // If namespace is missing, do not block based on global hash matches.
  const contentHashDuplicates = targetNamespace
    ? await findDuplicatesByContentHash(contentHash, targetNamespace)
    : [];

  // Optional warning path for cross-namespace collisions.
  let crossNamespaceContentHashMatches: CachedCloudflareImage[] = [];
  if (contentHashDuplicates.length === 0) {
    const globalHashMatches = await findDuplicatesByContentHash(contentHash);
    crossNamespaceContentHashMatches = targetNamespace
      ? globalHashMatches.filter((match) => (match.namespace || '') !== targetNamespace)
      : globalHashMatches;
  }

  return {
    originalUrlWarning: originalUrlMatches.length
      ? buildOriginalUrlReuseWarning(normalizedOriginalUrl!, originalUrlMatches)
      : undefined,
    contentHashDuplicates,
    crossNamespaceContentHashMatches,
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

export function logCrossNamespaceContentHashWarning(params: {
  logScope: string;
  contentHash: string;
  targetNamespace?: string;
  matches: CachedCloudflareImage[];
}): void {
  const { logScope, contentHash, targetNamespace, matches } = params;
  const summary = summarizeDuplicateMatches(matches);
  const namespaces = Array.from(
    new Set(matches.map((match) => (match.namespace && match.namespace.trim()) ? match.namespace.trim() : null))
  );
  console.warn(`[${logScope}] Content hash exists in other namespaces (warning only)`, {
    contentHash,
    targetNamespace: targetNamespace || null,
    namespaces,
    duplicateIds: summary.duplicateIds,
    folders: summary.duplicateFolders,
  });
}
