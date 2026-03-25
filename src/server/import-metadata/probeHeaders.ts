import type { HeaderProbeResult } from '@/server/import-metadata/types';
import { fetchWithCertFallback } from '@/server/import-metadata/http';

export async function probeHeaders(
  url: string,
  options?: { allowInsecure?: boolean; cookieHeader?: string | null }
): Promise<HeaderProbeResult> {
  try {
    const response = await fetchWithCertFallback(url, options?.allowInsecure, {
      method: 'HEAD',
      redirect: 'follow',
      headers: options?.cookieHeader ? { Cookie: options.cookieHeader } : undefined,
    });
    if (!response.ok) {
      return {};
    }
    const rawContentType = response.headers.get('content-type') ?? '';
    const normalizedContentType = rawContentType.split(';')[0].trim().toLowerCase();
    const contentLengthValue = Number(response.headers.get('content-length'));
    return {
      contentType: normalizedContentType || undefined,
      fileSizeBytes:
        Number.isFinite(contentLengthValue) && contentLengthValue > 0
          ? contentLengthValue
          : undefined,
    };
  } catch {
    return {};
  }
}
