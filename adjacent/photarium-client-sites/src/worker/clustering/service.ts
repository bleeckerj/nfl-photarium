import type { ProjectAssetRecord } from '../assets/types';

/**
 * Lightweight clustering surface. The Worker currently reads stable cluster ids
 * from published assets and reserves Vectorize for future similarity expansion.
 */
export class ProjectClusteringService {
  groupByCluster(assets: ProjectAssetRecord[]): Record<string, ProjectAssetRecord[]> {
    return assets.reduce<Record<string, ProjectAssetRecord[]>>((accumulator, asset) => {
      const key = asset.clusterId ?? 'unclustered';
      accumulator[key] = accumulator[key] ?? [];
      accumulator[key].push(asset);
      return accumulator;
    }, {});
  }
}
