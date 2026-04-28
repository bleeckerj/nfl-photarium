export interface ClientProject {
  id: string;
  publicSlug: string;
  title: string;
  status: string;
  expiresAt: string | null;
  delivery: {
    viewPresets: Array<{ name: string; label: string; sourceVariant: string }>;
    downloadPresets: Array<{ name: string; label: string }>;
    allowedOutputFormats: string[];
  };
}

export interface ClientAsset {
  id: string;
  assetType: 'image' | 'video';
  filename: string;
  displayName: string;
  description: string;
  visibleTags: string[];
  fileSizeBytes: number | null;
  aspectRatio: string | null;
  dimensions: { width: number; height: number } | null;
  isCanonical: boolean;
  hasEmbedding: boolean;
  clusterId: string | null;
  clusterLabel: string | null;
  previewVariant: string | null;
  videoPlaybackUrl: string | null;
  videoHlsUrl: string | null;
  videoThumbnailUrl: string | null;
  videoPreviewUrl: string | null;
  videoDownloadUrl: string | null;
  preferredVideoPlaybackUrl: string | null;
  preferredVideoPlaybackKind: 'hls' | 'file' | null;
  hasDownloadableVideo: boolean;
  videoDurationSeconds: number | null;
  sortOrder: number;
}

export type SubmissionState = 'idle' | 'submitting' | 'submitted' | 'error';

export interface AppState {
  project: ClientProject | null;
  assets: ClientAsset[];
  activeTag: string | null;
  selectedAssetIds: Set<string>;
  lightboxAssetId: string | null;
  inlinePlayingAssetId: string | null;
  shortlistTrayExpanded: boolean;
  shortlistSubmitExpanded: boolean;
  submissionState: SubmissionState;
}
