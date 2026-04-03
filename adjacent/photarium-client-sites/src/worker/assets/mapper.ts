import type { ProjectAssetRecord } from './types';

/**
 * Public asset payload with worker-fronted URLs only.
 */
export const mapAssetToPublicPayload = (asset: ProjectAssetRecord) => ({
  id: asset.publicAssetId,
  filename: asset.filename,
  displayName: asset.displayName ?? asset.filename,
  description: asset.description ?? '',
  visibleTags: asset.visibleTags,
  aspectRatio: asset.aspectRatio ?? null,
  dimensions: asset.width && asset.height ? { width: asset.width, height: asset.height } : null,
  isCanonical: asset.isCanonical,
  hasEmbedding: asset.hasEmbedding,
  clusterId: asset.clusterId ?? null,
  clusterLabel: asset.clusterLabel ?? null,
  previewVariant: asset.previewVariant ?? null,
  sortOrder: asset.sortOrder,
});
