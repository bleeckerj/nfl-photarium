/**
 * Published asset snapshot record stored per project.
 */
export interface ProjectAssetRecord {
  assetType: 'image' | 'video';
  publicAssetId: string;
  projectId: string;
  revisionId: string;
  sourceAssetId: string;
  filename: string;
  displayName?: string;
  description?: string;
  visibleTags: string[];
  sourceTags: string[];
  uploadedAt: string;
  fileSizeBytes?: number;
  aspectRatio?: string;
  width?: number;
  height?: number;
  isCanonical: boolean;
  hasEmbedding: boolean;
  clusterId?: string;
  clusterLabel?: string;
  previewVariant?: string;
  videoPlaybackUrl?: string;
  videoHlsUrl?: string;
  videoThumbnailUrl?: string;
  videoPreviewUrl?: string;
  videoDownloadUrl?: string;
  videoDurationSeconds?: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}
