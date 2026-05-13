export type VariantAssignmentAsset = {
  id: string;
  parentId?: string;
  namespace?: string;
  filename?: string;
  displayName?: string;
  assetType?: 'image' | 'video';
};

export type VariantAssignmentCandidate<TAsset extends VariantAssignmentAsset> = {
  asset: TAsset;
  availability: 'available' | 'unavailable';
  unavailableReason?: string;
  parentAsset?: TAsset;
};

const normalizeNamespace = (value?: string | null) =>
  typeof value === 'string' ? value.trim() : '';

const matchesNamespace = (assetNamespace: string | undefined, expectedNamespace: string) =>
  normalizeNamespace(assetNamespace) === expectedNamespace;

const uniqueById = <TAsset extends VariantAssignmentAsset>(assets: TAsset[]) => {
  const seen = new Set<string>();
  return assets.filter((asset) => {
    if (!asset.id || seen.has(asset.id)) {
      return false;
    }
    seen.add(asset.id);
    return true;
  });
};

export function buildVariantAssignmentCandidates<TAsset extends VariantAssignmentAsset>({
  assets,
  currentAssetId,
  familyRootId,
  namespace,
  includeCrossNamespaceOrphans = false,
}: {
  assets: TAsset[];
  currentAssetId?: string;
  familyRootId?: string;
  namespace: string;
  includeCrossNamespaceOrphans?: boolean;
}): VariantAssignmentCandidate<TAsset>[] {
  const uniqueAssets = uniqueById(assets);
  const byId = new Map(uniqueAssets.map((asset) => [asset.id, asset]));
  const childCountsByParentId = uniqueAssets.reduce((counts, asset) => {
    if (!asset.parentId) {
      return counts;
    }
    counts.set(asset.parentId, (counts.get(asset.parentId) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());
  const familyIds = new Set(
    uniqueAssets
      .filter((asset) => asset.id === familyRootId || asset.parentId === familyRootId)
      .map((asset) => asset.id)
  );

  return uniqueAssets
    .filter((asset) => {
      const sameNamespace = matchesNamespace(asset.namespace, namespace);
      const isOrphan = !asset.parentId && (childCountsByParentId.get(asset.id) ?? 0) === 0;
      if (!sameNamespace && !(includeCrossNamespaceOrphans && isOrphan)) return false;
      if (asset.id === currentAssetId) return false;
      if (familyIds.has(asset.id)) return false;
      return true;
    })
    .map((asset) => {
      const parentAsset = asset.parentId ? byId.get(asset.parentId) : undefined;
      if (asset.parentId) {
        return {
          asset,
          availability: 'unavailable' as const,
          unavailableReason: 'already-assigned',
          parentAsset,
        };
      }
      if ((childCountsByParentId.get(asset.id) ?? 0) > 0) {
        return {
          asset,
          availability: 'unavailable' as const,
          unavailableReason: 'has-variants',
        };
      }
      return {
        asset,
        availability: 'available' as const,
      };
    });
}

export function listAvailableVariantAssignmentAssets<TAsset extends VariantAssignmentAsset>(
  candidates: VariantAssignmentCandidate<TAsset>[]
) {
  return candidates
    .filter((candidate) => candidate.availability === 'available')
    .map((candidate) => candidate.asset);
}
