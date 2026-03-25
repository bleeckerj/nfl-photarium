import {
  cleanupExpiredImportSessions,
  getTempAssetByUrl,
  storeTempAsset,
} from '@/server/import-metadata/tempAssetStore';
import { normalizeImportMetadata } from '@/server/import-metadata/normalizeMetadata';
import { probeHeaders } from '@/server/import-metadata/probeHeaders';
import { probePartialImage } from '@/server/import-metadata/probePartialImage';
import { probeFullDownload } from '@/server/import-metadata/probeFullDownload';
import type { EnrichmentPatch, EnrichmentServiceInput } from '@/server/import-metadata/types';

const needsDimensions = (metadata?: { dimensions?: { width?: number; height?: number } }) =>
  !(metadata?.dimensions?.width && metadata.dimensions.height);

const needsFileSize = (metadata?: { fileSizeBytes?: number }) =>
  !(typeof metadata?.fileSizeBytes === 'number' && metadata.fileSizeBytes > 0);

export async function enrichImportCandidateMetadata(
  input: EnrichmentServiceInput
): Promise<EnrichmentPatch> {
  await cleanupExpiredImportSessions();

  const tempAsset = await getTempAssetByUrl(input.sessionId, input.url);
  if (tempAsset) {
    return {
      id: input.url,
      url: input.url,
      metadata: normalizeImportMetadata({
        existing: input.existingMetadata,
        tempAsset,
      }),
      tempAssetKey: tempAsset.assetKey,
    };
  }

  const existing = input.existingMetadata;
  let headers = undefined;
  let partial = undefined;
  let full = null;

  if (needsFileSize(existing) || !existing?.contentType) {
    headers = await probeHeaders(input.url, {
      allowInsecure: input.allowInsecure,
      cookieHeader: input.cookieHeader,
    });
  }

  if (needsDimensions(existing) || needsFileSize(existing)) {
    partial = await probePartialImage(input.url, {
      allowInsecure: input.allowInsecure,
      cookieHeader: input.cookieHeader,
    });
  }

  const shouldFullDownload =
    needsDimensions({
      dimensions: partial?.dimensions ?? existing?.dimensions,
    }) ||
    needsFileSize({
      fileSizeBytes:
        partial?.fileSizeBytes ?? headers?.fileSizeBytes ?? existing?.fileSizeBytes,
    });

  let tempAssetKey: string | undefined;
  if (shouldFullDownload) {
    full = await probeFullDownload(input.url, {
      allowInsecure: input.allowInsecure,
      cookieHeader: input.cookieHeader,
    });
    if (full) {
      const stored = await storeTempAsset({
        sessionId: input.sessionId,
        url: input.url,
        buffer: full.buffer,
        filename: full.filename ?? input.filename,
        contentType: full.contentType,
        dimensions: full.dimensions,
      });
      tempAssetKey = stored.assetKey;
    }
  }

  const metadata = normalizeImportMetadata({
    existing,
    headers,
    partial,
    full,
    failed: !full && !partial?.dimensions && !partial?.fileSizeBytes && !headers?.fileSizeBytes,
  });

  return {
    id: input.url,
    url: input.url,
    metadata,
    tempAssetKey,
  };
}
