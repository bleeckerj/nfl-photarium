/**
 * Versioned semantic contracts shared by publish callers and the client-sites app.
 */

export type ProjectLifecycleStatus = 'draft' | 'published' | 'shadow' | 'archived';
export type OutputFormat = 'jpg' | 'png' | 'webp';
export type ImageFitMode = 'scale-down' | 'contain' | 'cover';
export type PublishedAssetType = 'image' | 'video';

export interface SecretLinkAccessPolicy {
  mode: 'secret-link';
  sessionTtlSeconds: number;
}

export interface VisibleTagPolicy {
  mode: 'prefix-filter';
  hiddenPrefixes: string[];
  hiddenExact: string[];
}

export interface ViewPresetDefinition {
  name: string;
  label: string;
  sourceVariant: string;
}

export interface DownloadPresetDefinition {
  name: string;
  label: string;
  width?: number;
  height?: number;
  fit?: ImageFitMode;
  quality?: number;
  background?: string;
}

export interface DownloadPresetPolicy {
  viewPresets: ViewPresetDefinition[];
  downloadPresets: DownloadPresetDefinition[];
  allowedOutputFormats: readonly OutputFormat[];
}

export interface PublishedProjectAsset {
  assetType: PublishedAssetType;
  projectAssetId: string;
  sourceAssetId: string;
  filename: string;
  displayName?: string;
  description?: string;
  visibleTags?: string[];
  sourceTags: string[];
  uploadedAt: string;
  fileSizeBytes?: number;
  aspectRatio?: string;
  dimensions?: {
    width: number;
    height: number;
  };
  isCanonical: boolean;
  hasEmbedding: boolean;
  clusterSeed?: {
    id?: string;
    label?: string;
  };
  previewVariant?: string;
  videoPlaybackUrl?: string;
  videoHlsUrl?: string;
  videoThumbnailUrl?: string;
  videoPreviewUrl?: string;
  videoDownloadUrl?: string;
  videoDurationSeconds?: number;
  sortOrder?: number;
}

export interface PublishedProjectManifest {
  schemaVersion: '2026-04-01';
  project: {
    id: string;
    publicSlug: string;
    status: ProjectLifecycleStatus;
    expiresAt?: string | null;
    title: string;
    accessPolicy: SecretLinkAccessPolicy;
    visibleTagPolicy: VisibleTagPolicy;
    downloadPresetPolicy: DownloadPresetPolicy;
  };
  delivery: DownloadPresetPolicy;
  revision: {
    projectRevisionId: string;
    generatedAt: string;
    sourceNamespaces: string[];
  };
  assets: PublishedProjectAsset[];
}

export interface PublishedProjectDelta {
  schemaVersion: '2026-04-01';
  projectId: string;
  projectRevisionId: string;
  assets: PublishedProjectAsset[];
}

export interface ProjectStatusChange {
  schemaVersion: '2026-04-01';
  projectId: string;
  status: ProjectLifecycleStatus;
}

export interface ClientShortlistSubmission {
  schemaVersion: '2026-04-01';
  clientSessionId: string;
  selectedAssetIds: string[];
  clientName?: string;
  clientEmail?: string;
  note?: string;
}

export interface CreateProjectRequest {
  title: string;
  expiresAt?: string | null;
  accessPolicy?: SecretLinkAccessPolicy;
  visibleTagPolicy?: VisibleTagPolicy;
  downloadPresetPolicy?: DownloadPresetPolicy;
}
