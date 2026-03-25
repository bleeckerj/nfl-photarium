import sharp from 'sharp';
import type { PartialProbeResult } from '@/server/import-metadata/types';
import { fetchWithCertFallback } from '@/server/import-metadata/http';

const PARTIAL_RANGE = 'bytes=0-65535';

const parseContentRangeTotal = (value: string | null) => {
  if (!value) return undefined;
  const match = /bytes\s+\d+-\d+\/(\d+|\*)/i.exec(value);
  if (!match || match[1] === '*') return undefined;
  const total = Number(match[1]);
  return Number.isFinite(total) && total > 0 ? total : undefined;
};

export async function probePartialImage(
  url: string,
  options?: { allowInsecure?: boolean; cookieHeader?: string | null }
): Promise<PartialProbeResult> {
  try {
    const response = await fetchWithCertFallback(url, options?.allowInsecure, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        Range: PARTIAL_RANGE,
        ...(options?.cookieHeader ? { Cookie: options.cookieHeader } : {}),
      },
    });
    if (!response.ok) {
      return {};
    }

    const rawContentType = response.headers.get('content-type') ?? '';
    const normalizedContentType = rawContentType.split(';')[0].trim().toLowerCase();
    const contentRangeTotal = parseContentRangeTotal(response.headers.get('content-range'));
    const contentLength = Number(response.headers.get('content-length'));
    const buffer = Buffer.from(await response.arrayBuffer());

    let dimensions: PartialProbeResult['dimensions'];
    try {
      const metadata = await sharp(buffer, { failOn: 'none' }).metadata();
      if (metadata.width && metadata.height) {
        dimensions = { width: metadata.width, height: metadata.height };
      }
    } catch {
      dimensions = undefined;
    }

    const exactBytes =
      contentRangeTotal ??
      (response.status === 200 && Number.isFinite(contentLength) && contentLength > 0
        ? contentLength
        : undefined);

    return {
      contentType: normalizedContentType || undefined,
      fileSizeBytes: exactBytes,
      dimensions,
    };
  } catch {
    return {};
  }
}
