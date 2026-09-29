import { setTimeout as delay } from 'node:timers/promises';
import { apiRequestRaw, PhotariumApiError } from '../shared/api-client.js';

const RETRY_DELAYS_MS = [250, 750];

function isTransientDownloadFailure(error: unknown): boolean {
  if (error instanceof PhotariumApiError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  if (!(error instanceof Error)) return false;
  const cause = error.cause;
  const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined;
  return (error instanceof TypeError && error.message === 'fetch failed') ||
    (typeof code === 'string' && [
      'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN',
      'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
    ].includes(code));
}

export async function downloadImageById(imageId: string, variant?: string) {
  // Retry only the idempotent download, including interrupted response bodies.
  // Retrying a generation request could create and bill for a second image.
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await downloadImageOnce(imageId, variant);
    } catch (error) {
      if (attempt >= RETRY_DELAYS_MS.length || !isTransientDownloadFailure(error)) throw error;
      await delay(RETRY_DELAYS_MS[attempt]);
    }
  }
}

async function downloadImageOnce(
  imageId: string,
  variant?: string
): Promise<{
  filename?: string;
  contentType?: string;
  size?: number;
  base64: string;
  requestedVariant?: string;
  servedVariant?: string;
}> {
  const params = new URLSearchParams();
  if (variant) params.set('variant', variant);
  const response = await apiRequestRaw(`/api/images/${imageId}/download${params.toString() ? `?${params}` : ''}`, { method: 'GET' });
  const contentType = response.headers.get('content-type') || undefined;
  const disposition = response.headers.get('content-disposition') || undefined;
  const sizeHeader = response.headers.get('content-length') || undefined;
  const requestedVariant = response.headers.get('x-photarium-variant-requested') || undefined;
  const servedVariant = response.headers.get('x-photarium-variant-served') || undefined;
  const arrayBuffer = await response.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString('base64');
  const filenameMatch = disposition?.match(/filename="?([^";]+)"?/i);
  return {
    filename: filenameMatch?.[1],
    contentType,
    size: sizeHeader ? Number(sizeHeader) : undefined,
    base64,
    requestedVariant,
    servedVariant,
  };
}

export async function downloadOriginalImageById(imageId: string): Promise<{
  filename?: string;
  contentType?: string;
  size?: number;
  base64: string;
  variantUsed: string;
  fallbackUsed: boolean;
  fallbackReason?: string;
}> {
  try {
    const result = await downloadImageById(imageId, 'original');
    return {
      ...result,
      variantUsed: 'original',
      fallbackUsed: false,
    };
  } catch (error) {
    const originalError = error instanceof Error ? error.message : String(error);
    try {
      const fallback = await downloadImageById(imageId);
      return {
        ...fallback,
        variantUsed: 'default',
        fallbackUsed: true,
        fallbackReason: originalError,
      };
    } catch (fallbackError) {
      const fallbackDetail = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(`Source image ${imageId} download failed. Original: ${originalError}. Fallback: ${fallbackDetail}`, {
        cause: fallbackError,
      });
    }
  }
}
