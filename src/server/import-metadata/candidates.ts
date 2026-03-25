import { createHash } from 'crypto';
import type {
  ImportCandidate,
  ImportCandidateKind,
  ImportCandidateMetadata,
  ImportDimensions,
  ImportMetadataSource,
} from '@/server/import-metadata/types';

export const createImportCandidateId = (kind: ImportCandidateKind, url: string) =>
  createHash('sha1').update(`${kind}:${url}`).digest('hex');

export const deriveMetadataStatus = (metadata: Partial<ImportCandidateMetadata> | undefined) => {
  const hasDimensions = Boolean(
    metadata?.dimensions?.width && metadata?.dimensions?.height
  );
  const hasFileSize = typeof metadata?.fileSizeBytes === 'number' && metadata.fileSizeBytes > 0;
  if (hasDimensions && hasFileSize) return 'resolved' as const;
  if (hasDimensions || hasFileSize || metadata?.contentType) return 'partial' as const;
  return 'pending' as const;
};

export const buildImportCandidateMetadata = ({
  dimensions,
  fileSizeBytes,
  contentType,
  sources,
}: {
  dimensions?: ImportDimensions;
  fileSizeBytes?: number;
  contentType?: string;
  sources?: {
    dimensions?: ImportMetadataSource;
    fileSize?: ImportMetadataSource;
  };
}): ImportCandidateMetadata => ({
  dimensions,
  fileSizeBytes,
  contentType,
  sources,
  status: deriveMetadataStatus({ dimensions, fileSizeBytes, contentType }),
});

export const toImportCandidate = ({
  kind,
  url,
  filename,
  previewUrl,
  posterUrl,
  isBlobSource,
  metadata,
  tempAssetKey,
}: {
  kind: ImportCandidateKind;
  url: string;
  filename: string;
  previewUrl?: string;
  posterUrl?: string;
  isBlobSource?: boolean;
  metadata?: Partial<ImportCandidateMetadata>;
  tempAssetKey?: string;
}): ImportCandidate => ({
  id: createImportCandidateId(kind, url),
  kind,
  url,
  filename,
  previewUrl,
  posterUrl,
  isBlobSource: Boolean(isBlobSource),
  metadata: {
    dimensions: metadata?.dimensions,
    fileSizeBytes: metadata?.fileSizeBytes,
    contentType: metadata?.contentType,
    sources: metadata?.sources,
    status: metadata?.status ?? deriveMetadataStatus(metadata),
  },
  tempAssetKey,
});
