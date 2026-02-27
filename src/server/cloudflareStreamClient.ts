import { cleanString } from '@/utils/cloudflareMetadata';

type StreamCredentials = {
  accountId: string;
  apiToken: string;
};

type StreamErrorPayload = {
  errors?: Array<{ message?: string }>;
};

type StreamUploadResult = {
  uid: string;
  thumbnail?: string;
  preview?: string;
  readyToStream?: boolean;
  input?: {
    width?: number;
    height?: number;
  };
  status?: {
    state?: string;
    errorReasonCode?: string;
    errorReasonText?: string;
  };
  duration?: number;
};

const STREAM_API_BASE = 'https://api.cloudflare.com/client/v4';

const getStreamApiToken = () =>
  process.env.CLOUDFLARE_STREAM_API_TOKEN ||
  process.env.CLOUDFLARE_API_TOKEN;

export const getCloudflareStreamCredentials = (): StreamCredentials => {
  const accountId = cleanString(process.env.CLOUDFLARE_ACCOUNT_ID);
  const apiToken = cleanString(getStreamApiToken());
  if (!accountId || !apiToken) {
    throw new Error(
      'Cloudflare Stream credentials not configured. Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_STREAM_API_TOKEN (or CLOUDFLARE_API_TOKEN).'
    );
  }
  return { accountId, apiToken };
};

const buildApiUrl = (accountId: string, path: string) =>
  `${STREAM_API_BASE}/accounts/${accountId}/stream${path}`;

const parseStreamError = async (response: Response) => {
  let payload: StreamErrorPayload | null = null;
  try {
    payload = (await response.json()) as StreamErrorPayload;
  } catch {
    payload = null;
  }
  return payload?.errors?.[0]?.message || `Stream API request failed (${response.status})`;
};

const streamApiFetch = async <T>(
  path: string,
  init: RequestInit,
  credentials?: StreamCredentials
): Promise<T> => {
  const { accountId, apiToken } = credentials ?? getCloudflareStreamCredentials();
  const response = await fetch(buildApiUrl(accountId, path), {
    ...init,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      ...(init.headers || {}),
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(await parseStreamError(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const raw = await response.text().catch(() => '');
  if (!raw.trim()) {
    return undefined as T;
  }

  let json: { result?: T };
  try {
    json = JSON.parse(raw) as { result?: T };
  } catch {
    throw new Error('Stream API response was not JSON');
  }
  if (!json.result) {
    throw new Error('Stream API response missing result payload');
  }
  return json.result;
};

export type CreateStreamVideoFromFileInput = {
  buffer: Buffer;
  fileName: string;
  contentType: string;
  meta?: Record<string, string>;
  maxDurationSeconds?: number;
  requireSignedUrls?: boolean;
};

export async function createStreamVideoFromFile(
  input: CreateStreamVideoFromFileInput,
  credentials?: StreamCredentials
): Promise<StreamUploadResult> {
  const formData = new FormData();
  const fileBlob = new Blob([new Uint8Array(input.buffer)], { type: input.contentType });
  formData.append('file', fileBlob, input.fileName);

  if (input.meta && Object.keys(input.meta).length > 0) {
    formData.append('meta', JSON.stringify(input.meta));
  }
  if (typeof input.maxDurationSeconds === 'number' && Number.isFinite(input.maxDurationSeconds)) {
    formData.append('maxDurationSeconds', String(Math.max(1, Math.round(input.maxDurationSeconds))));
  }
  if (typeof input.requireSignedUrls === 'boolean') {
    formData.append('requireSignedURLs', input.requireSignedUrls ? 'true' : 'false');
  }

  return streamApiFetch<StreamUploadResult>(
    '',
    {
      method: 'POST',
      body: formData,
    },
    credentials
  );
}

export type CreateStreamVideoFromUrlInput = {
  sourceUrl: string;
  meta?: Record<string, string>;
  requireSignedUrls?: boolean;
};

export async function createStreamVideoFromUrl(
  input: CreateStreamVideoFromUrlInput,
  credentials?: StreamCredentials
): Promise<StreamUploadResult> {
  return streamApiFetch<StreamUploadResult>(
    '/copy',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: input.sourceUrl,
        meta: input.meta,
        requireSignedURLs: input.requireSignedUrls,
      }),
    },
    credentials
  );
}

export async function getStreamVideo(
  uid: string,
  credentials?: StreamCredentials
): Promise<StreamUploadResult> {
  return streamApiFetch<StreamUploadResult>(
    `/${encodeURIComponent(uid)}`,
    {
      method: 'GET',
    },
    credentials
  );
}

export async function deleteStreamVideo(uid: string, credentials?: StreamCredentials): Promise<void> {
  await streamApiFetch<unknown>(
    `/${encodeURIComponent(uid)}`,
    {
      method: 'DELETE',
    },
    credentials
  );
}
