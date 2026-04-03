/**
 * Published asset snapshot record stored per project.
 */
export interface ProjectAssetRecord {
  publicAssetId: string;
  projectId: string;
  revisionId: string;
  sourceImageId: string;
  filename: string;
  displayName?: string;
  description?: string;
  visibleTags: string[];
  sourceTags: string[];
  uploadedAt: string;
  aspectRatio?: string;
  width?: number;
  height?: number;
  isCanonical: boolean;
  hasEmbedding: boolean;
  clusterId?: string;
  clusterLabel?: string;
  previewVariant?: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}
