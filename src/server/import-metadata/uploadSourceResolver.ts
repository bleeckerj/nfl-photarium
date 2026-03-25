import { extractFilenameFromUrl } from '@/utils/filename';
import {
  fetchWithCertFallback,
  getFilenameFromContentDisposition,
  getMimeFromImageUrl,
} from '@/server/import-metadata/http';
import { readTempAssetBuffer } from '@/server/import-metadata/tempAssetStore';

export async function resolveUploadSource(params: {
  url: string;
  sessionId?: string;
  tempAssetKey?: string;
  allowInsecure?: boolean;
  cookieHeader?: string | null;
}) {
  if (params.sessionId && params.tempAssetKey) {
    const temp = await readTempAssetBuffer(params.sessionId, params.tempAssetKey);
    if (temp) {
      return {
        buffer: temp.buffer,
        contentType: temp.asset.contentType || getMimeFromImageUrl(params.url),
        filename:
          temp.asset.filename ||
          extractFilenameFromUrl(params.url, temp.asset.contentType || undefined),
      };
    }
  }

  const response = await fetchWithCertFallback(params.url, params.allowInsecure, {
    method: 'GET',
    redirect: 'follow',
    headers: params.cookieHeader ? { Cookie: params.cookieHeader } : undefined,
  });

  const rawContentType = response.headers.get('content-type') ?? '';
  const normalizedContentType =
    rawContentType.split(';')[0].trim().toLowerCase() || getMimeFromImageUrl(params.url);
  const filename =
    getFilenameFromContentDisposition(response.headers.get('content-disposition')) ??
    extractFilenameFromUrl(params.url, normalizedContentType);

  return {
    response,
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: normalizedContentType,
    filename,
  };
}
