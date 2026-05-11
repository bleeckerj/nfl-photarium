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
}: {
  assets: TAsset[];
  currentAssetId?: string;
  familyRootId?: string;
  namespace: string;
}): VariantAssignmentCandidate<TAsset>[] {
  const uniqueAssets = uniqueById(assets);
  const byId = new Map(uniqueAssets.map((asset) => [asset.id, asset]));
  const familyIds = new Set(
    uniqueAssets
      .filter((asset) => asset.id === familyRootId || asset.parentId === familyRootId)
      .map((asset) => asset.id)
  );

  return uniqueAssets
    .filter((asset) => {
      if (!matchesNamespace(asset.namespace, namespace)) return false;
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
