import type { VariantAssignmentCandidate } from '@/utils/variantAssignmentCandidates';

export type AdoptAssetTypeFilter = '' | 'image' | 'video';
export type AdoptVariationScope = 'current' | 'all';

export type AdoptVariationSearchAsset = {
  id: string;
  assetType?: 'image' | 'video';
  namespace?: string;
  uploaded?: string;
  filename?: string;
  displayName?: string;
  folder?: string;
  tags?: string[];
  description?: string;
  altTag?: string;
  altText?: string;
};

export type AdoptVariationCandidate<TAsset extends AdoptVariationSearchAsset> =
  VariantAssignmentCandidate<TAsset>;

export type AdoptVariationCandidatePage<TAsset extends AdoptVariationSearchAsset> = {
  filteredAssignmentCandidates: AdoptVariationCandidate<TAsset>[];
  pagedAssignmentCandidates: AdoptVariationCandidate<TAsset>[];
  page: number;
  totalPages: number;
  pageStart: number;
  pageEnd: number;
};

const normalize = (value?: string | null) => String(value ?? '').trim().toLowerCase();

const isVideoAsset = (asset: AdoptVariationSearchAsset) => asset.assetType === 'video';

export const getDefaultAdoptVariationScope = (currentNamespace?: string | null): AdoptVariationScope =>
  normalize(currentNamespace) ? 'current' : 'all';

const uploadedTime = (value?: string | null) => {
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

const compareCandidatesByRecentUpload = <TAsset extends AdoptVariationSearchAsset>(
  left: AdoptVariationCandidate<TAsset>,
  right: AdoptVariationCandidate<TAsset>
) => {
  const uploadedDelta = uploadedTime(right.asset.uploaded) - uploadedTime(left.asset.uploaded);
  if (uploadedDelta !== 0) return uploadedDelta;
  return normalize(left.asset.id).localeCompare(normalize(right.asset.id));
};

export const clampAdoptVariationPage = (page: number, totalMatches: number, pageSize: number) => {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const totalPages = Math.max(1, Math.ceil(totalMatches / safePageSize));
  const safePage = Number.isFinite(page) ? Math.floor(page) : 1;
  return Math.min(totalPages, Math.max(1, safePage));
};

export function filterAdoptVariationCandidates<TAsset extends AdoptVariationSearchAsset>(
  candidates: AdoptVariationCandidate<TAsset>[],
  {
    search,
    folderFilter,
    assetTypeFilter,
    scope = 'current',
    currentNamespace,
  }: {
    search: string;
    folderFilter: string;
    assetTypeFilter: AdoptAssetTypeFilter;
    scope?: AdoptVariationScope;
    currentNamespace?: string;
  }
) {
  const normalizedFolder = normalize(folderFilter);
  const normalizedSearch = normalize(search);
  const normalizedCurrentNamespace = normalize(currentNamespace);
  const hasCurrentNamespace = typeof currentNamespace === 'string';

  return candidates.filter(({ asset, parentAsset }) => {
    if (
      scope === 'current' &&
      hasCurrentNamespace &&
      normalize(asset.namespace) !== normalizedCurrentNamespace
    ) {
      return false;
    }
    if (normalizedFolder && normalize(asset.folder) !== normalizedFolder) {
      return false;
    }
    if (assetTypeFilter === 'video' && !isVideoAsset(asset)) {
      return false;
    }
    if (assetTypeFilter === 'image' && isVideoAsset(asset)) {
      return false;
    }
    if (!normalizedSearch) {
      return true;
    }
    if (normalize(asset.id).includes(normalizedSearch)) {
      return true;
    }

    const haystack = [
      asset.displayName,
      asset.filename,
      asset.folder,
      asset.description,
      asset.altTag,
      asset.altText,
      parentAsset?.displayName,
      parentAsset?.filename,
      parentAsset?.id,
      ...(asset.tags || []),
    ]
      .filter(Boolean)
      .map(String)
      .join(' ')
      .toLowerCase();

    return haystack.includes(normalizedSearch);
  });
}

export function buildAdoptVariationCandidatePage<TAsset extends AdoptVariationSearchAsset>({
  candidates,
  search,
  folderFilter,
  assetTypeFilter,
  scope = 'current',
  currentNamespace,
  page,
  pageSize,
}: {
  candidates: AdoptVariationCandidate<TAsset>[];
  search: string;
  folderFilter: string;
  assetTypeFilter: AdoptAssetTypeFilter;
  scope?: AdoptVariationScope;
  currentNamespace?: string;
  page: number;
  pageSize: number;
}): AdoptVariationCandidatePage<TAsset> {
  const filteredAssignmentCandidates = filterAdoptVariationCandidates(candidates, {
    search,
    folderFilter,
    assetTypeFilter,
    scope,
    currentNamespace,
  }).sort(compareCandidatesByRecentUpload);
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const totalMatches = filteredAssignmentCandidates.length;
  const totalPages = Math.max(1, Math.ceil(totalMatches / safePageSize));
  const clampedPage = clampAdoptVariationPage(page, totalMatches, safePageSize);
  const start = (clampedPage - 1) * safePageSize;
  const pagedAssignmentCandidates = filteredAssignmentCandidates.slice(start, start + safePageSize);

  return {
    filteredAssignmentCandidates,
    pagedAssignmentCandidates,
    page: clampedPage,
    totalPages,
    pageStart: totalMatches === 0 ? 0 : start + 1,
    pageEnd: Math.min(totalMatches, start + pagedAssignmentCandidates.length),
  };
}
