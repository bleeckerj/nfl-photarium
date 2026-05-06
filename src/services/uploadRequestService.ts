export type UploadRequestResult = {
  response: Response;
  result: unknown;
};

export type UploadRequestOptions = {
  maxRetries?: number;
  retryDelayMs?: number;
  rateLimitDelayMs?: number;
  fetchImpl?: typeof fetch;
  delay?: (ms: number) => Promise<void>;
};

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 2_000;
const DEFAULT_RATE_LIMIT_DELAY_MS = 5_000;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const getPayloadErrorMessage = (payload: unknown): string => {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === 'string') {
      return error;
    }
  }
  return '';
};

const formatHttpFallbackError = (response: Response, bodyText: string): string => {
  const status = response.status;
  const statusText = response.statusText.trim();
  const statusLabel = [status || undefined, statusText || undefined].filter(Boolean).join(' ');
  const fallback = statusLabel ? `Upload failed (${statusLabel})` : 'Upload failed';
  const trimmed = bodyText.replace(/\s+/g, ' ').trim();

  if (!trimmed || trimmed.startsWith('<')) {
    return fallback;
  }

  return trimmed.length > 300 ? `${trimmed.slice(0, 300)}...` : trimmed;
};

export const parseUploadResponsePayload = async (response: Response): Promise<unknown> => {
  const bodyText = await response.text().catch(() => '');
  if (bodyText.trim()) {
    try {
      return JSON.parse(bodyText) as unknown;
    } catch {
      if (!response.ok) {
        return { error: formatHttpFallbackError(response, bodyText) };
      }
    }
  }

  return response.ok ? {} : { error: formatHttpFallbackError(response, bodyText) };
};

const shouldRetryResponse = (response: Response, payload: unknown): boolean => {
  if (response.status === 429 || response.status >= 500) {
    return true;
  }

  const errorMessage = getPayloadErrorMessage(payload).toLowerCase();
  return errorMessage.includes('rate limit') || errorMessage.includes('timeout');
};

const formatNetworkError = (error: unknown, attempts: number): string => {
  const detail = error instanceof Error && error.message.trim()
    ? error.message.trim()
    : 'network request failed';

  return `Failed to reach the upload API after ${attempts} attempts: ${detail}`;
};

export async function uploadFormDataWithRetry(
  endpoint: string,
  formData: FormData,
  options: UploadRequestOptions = {}
): Promise<UploadRequestResult> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const rateLimitDelayMs = options.rateLimitDelayMs ?? DEFAULT_RATE_LIMIT_DELAY_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const delay = options.delay ?? wait;
  const attempts = maxRetries + 1;

  for (let retryCount = 0; retryCount <= maxRetries; retryCount += 1) {
    let response: Response;

    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        body: formData,
      });
    } catch (error) {
      if (retryCount < maxRetries) {
        await delay(retryDelayMs);
        continue;
      }
      throw new Error(formatNetworkError(error, attempts));
    }

    const result = await parseUploadResponsePayload(response);

    if (!response.ok && retryCount < maxRetries && shouldRetryResponse(response, result)) {
      const errorMessage = getPayloadErrorMessage(result).toLowerCase();
      const waitTime = response.status === 429 || errorMessage.includes('rate limit')
        ? rateLimitDelayMs
        : retryDelayMs;
      await delay(waitTime);
      continue;
    }

    return { response, result };
  }

  throw new Error('Upload request failed');
}
