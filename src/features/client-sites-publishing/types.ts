export type ClientSiteStatus = 'draft' | 'published' | 'shadow' | 'archived';
export type ClientSiteOutputFormat = 'jpg' | 'png' | 'webp';

export interface ClientSiteAccessPolicy {
  mode: 'secret-link';
  sessionTtlSeconds: number;
}

export interface ClientSiteVisibleTagPolicy {
  mode: 'prefix-filter';
  hiddenPrefixes: string[];
  hiddenExact: string[];
}

export interface ClientSiteViewPreset {
  name: string;
  label: string;
  sourceVariant: string;
}

export interface ClientSiteDownloadPreset {
  name: string;
  label: string;
  width?: number;
  height?: number;
  fit?: 'scale-down' | 'contain' | 'cover';
  quality?: number;
  background?: string;
}

export interface ClientSiteDownloadPresetPolicy {
  viewPresets: ClientSiteViewPreset[];
  downloadPresets: ClientSiteDownloadPreset[];
  allowedOutputFormats: ClientSiteOutputFormat[];
}

export interface PublishedProjectAssetPayload {
  projectAssetId: string;
  sourceImageId: string;
  filename: string;
  displayName?: string;
  description?: string;
  visibleTags?: string[];
  sourceTags: string[];
  uploadedAt: string;
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
  sortOrder?: number;
}

export interface PublishedProjectManifestPayload {
  schemaVersion: '2026-04-01';
  project: {
    id: string;
    publicSlug: string;
    status: ClientSiteStatus;
    expiresAt?: string | null;
    title: string;
    accessPolicy: ClientSiteAccessPolicy;
    visibleTagPolicy: ClientSiteVisibleTagPolicy;
    downloadPresetPolicy: ClientSiteDownloadPresetPolicy;
  };
  delivery: ClientSiteDownloadPresetPolicy;
  revision: {
    projectRevisionId: string;
    generatedAt: string;
    sourceNamespaces: string[];
  };
  assets: PublishedProjectAssetPayload[];
}

export interface ClientSiteManifestRequest {
  project: {
    id: string;
    publicSlug: string;
    title: string;
    status?: ClientSiteStatus;
    expiresAt?: string | null;
    sourceNamespaces?: string[];
  };
  selection: {
    imageIds: string[];
  };
  accessPolicy?: ClientSiteAccessPolicy;
  visibleTagPolicy?: ClientSiteVisibleTagPolicy;
  downloadPresetPolicy?: ClientSiteDownloadPresetPolicy;
}

export interface ClientSitePublishRequest {
  targetBaseUrl: string;
  publishSecret?: string;
  adminApiToken?: string;
  project: {
    remoteProjectId?: string;
    publicSlug?: string;
    title: string;
    expiresAt?: string | null;
    sourceNamespaces?: string[];
  };
  selection: {
    imageIds: string[];
  };
  accessPolicy?: ClientSiteAccessPolicy;
  visibleTagPolicy?: ClientSiteVisibleTagPolicy;
  downloadPresetPolicy?: ClientSiteDownloadPresetPolicy;
}
