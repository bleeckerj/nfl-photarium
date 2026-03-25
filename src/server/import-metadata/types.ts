export type ImportMetadataStatus = 'pending' | 'partial' | 'resolved' | 'failed';

export type ImportDimensions = {
  width: number;
  height: number;
};

export type ImportMetadataSource =
  | 'head'
  | 'network'
  | 'browser'
  | 'probe'
  | 'temp';

export type ImportCandidateMetadata = {
  dimensions?: ImportDimensions;
  fileSizeBytes?: number;
  contentType?: string;
  status: ImportMetadataStatus;
  sources?: {
    dimensions?: ImportMetadataSource;
    fileSize?: ImportMetadataSource;
  };
};

export type ImportCandidateKind = 'image' | 'video';

export type ImportCandidate = {
  id: string;
  kind: ImportCandidateKind;
  url: string;
  filename: string;
  previewUrl?: string;
  posterUrl?: string;
  isBlobSource: boolean;
  metadata: ImportCandidateMetadata;
  tempAssetKey?: string;
};

export type HeaderProbeResult = {
  fileSizeBytes?: number;
  contentType?: string;
};

export type PartialProbeResult = {
  fileSizeBytes?: number;
  contentType?: string;
  dimensions?: ImportDimensions;
};

export type FullProbeResult = {
  fileSizeBytes: number;
  contentType?: string;
  dimensions?: ImportDimensions;
  buffer: Buffer;
  filename?: string;
};

export type TempAssetRecord = {
  assetKey: string;
  url: string;
  filePath: string;
  filename?: string;
  fileSizeBytes: number;
  contentType?: string;
  dimensions?: ImportDimensions;
  createdAt: string;
  updatedAt: string;
};

export type TempAssetSession = {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  assets: Record<string, TempAssetRecord>;
};

export type EnrichmentRequestCandidate = {
  id: string;
  url: string;
  filename?: string;
  metadata?: Partial<ImportCandidateMetadata>;
};

export type EnrichmentPatch = {
  id: string;
  url: string;
  metadata: ImportCandidateMetadata;
  tempAssetKey?: string;
};

export type EnrichmentServiceInput = {
  sessionId: string;
  url: string;
  filename?: string;
  existingMetadata?: Partial<ImportCandidateMetadata>;
  allowInsecure?: boolean;
  cookieHeader?: string | null;
};
