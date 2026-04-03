import type { AppState, ClientAsset } from './types';

export interface ClusterGroup {
  title: string;
  assets: ClientAsset[];
}

export interface LightboxAssetContext {
  asset: ClientAsset;
  assetIndex: number;
  assetCount: number;
  previousAssetId: string | null;
  nextAssetId: string | null;
}

const sortByOrder = (left: ClientAsset, right: ClientAsset): number =>
  left.sortOrder - right.sortOrder;

export const getVisibleAssets = (
  state: Pick<AppState, 'assets' | 'activeTag'>
): ClientAsset[] => {
  const activeTag = state.activeTag;
  const filteredAssets = activeTag
    ? state.assets.filter((asset) => asset.visibleTags.includes(activeTag))
    : state.assets;

  return [...filteredAssets].sort(sortByOrder);
};

export const getSelectedAssets = (
  state: Pick<AppState, 'assets' | 'selectedAssetIds'>
): ClientAsset[] =>
  state.assets
    .filter((asset) => state.selectedAssetIds.has(asset.id))
    .sort(sortByOrder);

export const getShortlistPreviewAssets = (
  state: Pick<AppState, 'assets' | 'selectedAssetIds'>,
  limit = 3
): ClientAsset[] => getSelectedAssets(state).slice(0, limit);

export const getAvailableTags = (
  state: Pick<AppState, 'assets'>
): string[] =>
  Array.from(new Set(state.assets.flatMap((asset) => asset.visibleTags))).sort();

export const groupAssetsByCluster = (assets: ClientAsset[]): ClusterGroup[] => {
  const groups = new Map<string, ClientAsset[]>();

  assets.forEach((asset) => {
    const key = asset.clusterLabel ?? 'All images';
    groups.set(key, [...(groups.get(key) ?? []), asset]);
  });

  return Array.from(groups.entries()).map(([title, groupedAssets]) => ({
    title,
    assets: groupedAssets.sort(sortByOrder),
  }));
};

export const getGalleryStructureSignature = (
  state: Pick<AppState, 'assets' | 'activeTag'>
): string =>
  groupAssetsByCluster(getVisibleAssets(state))
    .map((group) =>
      [
        group.title,
        ...group.assets.map((asset) =>
          [
            asset.id,
            asset.sortOrder,
            asset.displayName,
            asset.clusterLabel ?? '',
            asset.visibleTags.join(','),
          ].join(':')
        ),
      ].join('|')
    )
    .join('||');

export const getLightboxAssetContext = (
  state: Pick<AppState, 'assets' | 'activeTag' | 'lightboxAssetId'>
): LightboxAssetContext | null => {
  if (!state.lightboxAssetId) return null;

  const visibleAssets = getVisibleAssets(state);
  const assetIndex = visibleAssets.findIndex((asset) => asset.id === state.lightboxAssetId);
  if (assetIndex < 0) return null;

  return {
    asset: visibleAssets[assetIndex],
    assetIndex,
    assetCount: visibleAssets.length,
    previousAssetId: visibleAssets[assetIndex - 1]?.id ?? null,
    nextAssetId: visibleAssets[assetIndex + 1]?.id ?? null,
  };
};
