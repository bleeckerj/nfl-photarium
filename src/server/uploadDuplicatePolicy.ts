import { getCachedImages, type CachedCloudflareImage } from '@/server/cloudflareImageCache';
import { findDuplicatesByContentHash, findDuplicatesByOriginalUrl } from '@/server/duplicateDetector';

type DuplicateLocation = Array<string | null>;

export const DUPLICATE_UPLOAD_ACTIONS = ['reject', 'family', 'override'] as const;
export type UploadDuplicateAction = (typeof DUPLICATE_UPLOAD_ACTIONS)[number];

export type DuplicateFamilySelection = {
  requestedAction: 'family';
  matchedDuplicateIds: string[];
  canonicalParentId: string;
  storedAsVariant: true;
  provenance: 'duplicate-family-override';
};

export type DuplicateOverrideSelection = {
  requestedAction: 'override';
  matchedDuplicateIds: string[];
  admittedAsIndependentAsset: true;
  provenance: 'operator-duplicate-override';
};

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
  duplicateAction: UploadDuplicateAction;
  duplicateFamilySelection?: DuplicateFamilySelection;
  duplicateOverrideSelection?: DuplicateOverrideSelection;
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

const normalizeId = (value?: string | null) => (typeof value === 'string' ? value.trim() : '');

const normalizeUploadedAt = (value?: string) => {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
};

const resolveCanonicalRoot = (
  image: CachedCloudflareImage,
  byId: Map<string, CachedCloudflareImage>
): CachedCloudflareImage => {
  const visited = new Set<string>();
  let current = image;

  while (normalizeId(current.parentId)) {
    if (visited.has(current.id)) break;
    visited.add(current.id);

    const next = byId.get(normalizeId(current.parentId));
    if (!next) break;
    current = next;
  }

  return current;
};

async function resolveDuplicateFamilySelection(
  duplicates: CachedCloudflareImage[]
): Promise<DuplicateFamilySelection | undefined> {
  if (!duplicates.length) return undefined;

  const images = await getCachedImages();
  const imagesById = new Map(images.map((image) => [image.id, image]));
  const canonicalRoots = new Map<string, CachedCloudflareImage>();

  for (const duplicate of duplicates) {
    const root = resolveCanonicalRoot(duplicate, imagesById);
    canonicalRoots.set(root.id, root);
  }

  const selectedParent = Array.from(canonicalRoots.values()).sort((a, b) => {
    const uploadedDelta = normalizeUploadedAt(a.uploaded) - normalizeUploadedAt(b.uploaded);
    if (uploadedDelta !== 0) return uploadedDelta;
    return a.id.localeCompare(b.id);
  })[0];

  if (!selectedParent) return undefined;

  return {
    requestedAction: 'family',
    matchedDuplicateIds: duplicates.map((match) => match.id),
    canonicalParentId: selectedParent.id,
    storedAsVariant: true,
    provenance: 'duplicate-family-override',
  };
}

export function normalizeUploadDuplicateAction(value?: unknown): UploadDuplicateAction {
  if (typeof value !== 'string') return 'reject';
  const normalized = value.trim().toLowerCase();
  return normalized === 'family' || normalized === 'override' ? normalized : 'reject';
}

export async function evaluateUploadDeduplicationPolicy(params: {
  contentHash: string;
  normalizedOriginalUrl?: string;
  namespace?: string;
  duplicateAction?: unknown;
  requestedParentId?: string;
}): Promise<UploadDeduplicationResult> {
  const { contentHash, normalizedOriginalUrl } = params;
  const duplicateAction = normalizeUploadDuplicateAction(params.duplicateAction);
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
  const contentHashDuplicates = targetNamespace
    ? await findDuplicatesByContentHash(contentHash, targetNamespace)
    : [];

  let crossNamespaceContentHashMatches: CachedCloudflareImage[] = [];
  if (contentHashDuplicates.length === 0) {
    const globalHashMatches = await findDuplicatesByContentHash(contentHash);
    crossNamespaceContentHashMatches = targetNamespace
      ? globalHashMatches.filter((match) => (match.namespace || '') !== targetNamespace)
      : globalHashMatches;
  }

  const requestedParentId = normalizeId(params.requestedParentId);
  const duplicateFamilySelection =
    duplicateAction === 'family' && !requestedParentId && contentHashDuplicates.length > 0
      ? await resolveDuplicateFamilySelection(contentHashDuplicates)
      : undefined;
  const duplicateOverrideSelection =
    duplicateAction === 'override' && contentHashDuplicates.length > 0
      ? {
          requestedAction: 'override' as const,
          matchedDuplicateIds: contentHashDuplicates.map((match) => match.id),
          admittedAsIndependentAsset: true as const,
          provenance: 'operator-duplicate-override' as const,
        }
      : undefined;

  return {
    originalUrlWarning: originalUrlMatches.length
      ? buildOriginalUrlReuseWarning(normalizedOriginalUrl!, originalUrlMatches)
      : undefined,
    contentHashDuplicates,
    crossNamespaceContentHashMatches,
    duplicateAction,
    duplicateFamilySelection,
    duplicateOverrideSelection,
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
    new Set(matches.map((match) => (match.namespace && match.namespace.trim() ? match.namespace.trim() : null)))
  );
  console.warn(`[${logScope}] Content hash exists in other namespaces (warning only)`, {
    contentHash,
    targetNamespace: targetNamespace || null,
    namespaces,
    duplicateIds: summary.duplicateIds,
    folders: summary.duplicateFolders,
  });
}

export function logDuplicateFamilySelection(params: {
  logScope: string;
  contentHash: string;
  selection: DuplicateFamilySelection;
}): void {
  const { logScope, contentHash, selection } = params;
  console.info(`[${logScope}] Duplicate content admitted as family variant`, {
    contentHash,
    requestedAction: selection.requestedAction,
    matchedDuplicateIds: selection.matchedDuplicateIds,
    canonicalParentId: selection.canonicalParentId,
    storedAsVariant: selection.storedAsVariant,
    provenance: selection.provenance,
  });
}

export function logDuplicateOverrideSelection(params: {
  logScope: string;
  contentHash: string;
  selection: DuplicateOverrideSelection;
}): void {
  const { logScope, contentHash, selection } = params;
  console.info(`[${logScope}] Duplicate content admitted by operator override`, {
    contentHash,
    requestedAction: selection.requestedAction,
    matchedDuplicateIds: selection.matchedDuplicateIds,
    admittedAsIndependentAsset: selection.admittedAsIndependentAsset,
    provenance: selection.provenance,
  });
}

export function logUploadDeduplicationResult(params: {
  logScope: string;
  contentHash: string;
  originalUrl?: string;
  targetNamespace?: string;
  result: UploadDeduplicationResult;
}): void {
  const { logScope, contentHash, originalUrl, targetNamespace, result } = params;
  if (result.originalUrlWarning) {
    logOriginalUrlReuseWarning({ logScope, originalUrl, warning: result.originalUrlWarning });
  }
  if (result.crossNamespaceContentHashMatches.length) {
    logCrossNamespaceContentHashWarning({
      logScope,
      contentHash,
      targetNamespace,
      matches: result.crossNamespaceContentHashMatches,
    });
  }
  if (result.duplicateFamilySelection) {
    logDuplicateFamilySelection({ logScope, contentHash, selection: result.duplicateFamilySelection });
  }
  if (result.duplicateOverrideSelection) {
    logDuplicateOverrideSelection({ logScope, contentHash, selection: result.duplicateOverrideSelection });
  }
}
