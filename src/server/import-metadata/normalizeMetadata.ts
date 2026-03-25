import { buildImportCandidateMetadata, deriveMetadataStatus } from '@/server/import-metadata/candidates';
import type {
  FullProbeResult,
  HeaderProbeResult,
  ImportCandidateMetadata,
  PartialProbeResult,
  TempAssetRecord,
} from '@/server/import-metadata/types';

export function normalizeImportMetadata(params: {
  existing?: Partial<ImportCandidateMetadata>;
  headers?: HeaderProbeResult;
  partial?: PartialProbeResult;
  full?: FullProbeResult | null;
  tempAsset?: TempAssetRecord | null;
  failed?: boolean;
}) {
  const dimensions =
    params.tempAsset?.dimensions ??
    params.full?.dimensions ??
    params.partial?.dimensions ??
    params.existing?.dimensions;

  const fileSizeBytes =
    params.tempAsset?.fileSizeBytes ??
    params.full?.fileSizeBytes ??
    params.partial?.fileSizeBytes ??
    params.headers?.fileSizeBytes ??
    params.existing?.fileSizeBytes;

  const contentType =
    params.tempAsset?.contentType ??
    params.full?.contentType ??
    params.partial?.contentType ??
    params.headers?.contentType ??
    params.existing?.contentType;

  const metadata = buildImportCandidateMetadata({
    dimensions,
    fileSizeBytes,
    contentType,
    sources: {
      dimensions: params.tempAsset?.dimensions
        ? 'temp'
        : params.full?.dimensions
          ? 'temp'
          : params.partial?.dimensions
            ? 'probe'
            : params.existing?.sources?.dimensions,
      fileSize: params.tempAsset?.fileSizeBytes
        ? 'temp'
        : params.full?.fileSizeBytes
          ? 'temp'
          : params.partial?.fileSizeBytes
            ? 'probe'
            : params.headers?.fileSizeBytes
              ? 'head'
              : params.existing?.sources?.fileSize,
    },
  });

  if (params.failed && deriveMetadataStatus(metadata) === 'pending') {
    return { ...metadata, status: 'failed' as const };
  }

  return metadata;
}
