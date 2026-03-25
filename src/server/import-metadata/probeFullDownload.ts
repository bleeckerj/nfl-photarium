import sharp from 'sharp';
import type { FullProbeResult } from '@/server/import-metadata/types';
import {
  fetchWithCertFallback,
  getFilenameFromContentDisposition,
  getMimeFromImageUrl,
} from '@/server/import-metadata/http';
import { extractFilenameFromUrl } from '@/utils/filename';

export async function probeFullDownload(
  url: string,
  options?: { allowInsecure?: boolean; cookieHeader?: string | null }
): Promise<FullProbeResult | null> {
  const response = await fetchWithCertFallback(url, options?.allowInsecure, {
    method: 'GET',
    redirect: 'follow',
    headers: options?.cookieHeader ? { Cookie: options.cookieHeader } : undefined,
  });
  if (!response.ok) {
    return null;
  }

  const rawContentType = response.headers.get('content-type') ?? '';
  const normalizedContentType =
    rawContentType.split(';')[0].trim().toLowerCase() || getMimeFromImageUrl(url);
  const filename =
    getFilenameFromContentDisposition(response.headers.get('content-disposition')) ??
    extractFilenameFromUrl(url, normalizedContentType);
  const buffer = Buffer.from(await response.arrayBuffer());

  let dimensions: FullProbeResult['dimensions'];
  try {
    const metadata = await sharp(buffer).metadata();
    if (metadata.width && metadata.height) {
      dimensions = { width: metadata.width, height: metadata.height };
    }
  } catch {
    dimensions = undefined;
  }

  return {
    fileSizeBytes: buffer.byteLength,
    contentType: normalizedContentType || undefined,
    dimensions,
    buffer,
    filename,
  };
}
