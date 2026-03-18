type MuxCredentials = {
  tokenId: string;
  tokenSecret: string;
};

type MuxPlaybackId = {
  id: string;
  policy?: 'public' | 'signed';
};

type MuxAsset = {
  id: string;
  status?: 'preparing' | 'ready' | 'errored';
  playback_ids?: MuxPlaybackId[];
  master_access?: string;
  mp4_support?: string;
  max_stored_resolution?: string;
  errors?: { type?: string; messages?: string[] } | null;
};

type MuxResponse<T> = {
  data: T;
};

const MUX_API_BASE = 'https://api.mux.com/video/v1';

const getMuxCredentials = (): MuxCredentials => {
  const tokenId = (process.env.MUX_TOKEN_ID || '').trim();
  const tokenSecret = (process.env.MUX_TOKEN_SECRET || '').trim();
  if (!tokenId || !tokenSecret) {
    throw new Error('Mux credentials not configured. Set MUX_TOKEN_ID and MUX_TOKEN_SECRET.');
  }
  return { tokenId, tokenSecret };
};

const muxFetch = async <T>(
  path: string,
  init: RequestInit,
  credentials?: MuxCredentials
): Promise<T> => {
  const { tokenId, tokenSecret } = credentials ?? getMuxCredentials();
  const auth = Buffer.from(`${tokenId}:${tokenSecret}`).toString('base64');
  const response = await fetch(`${MUX_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    cache: 'no-store',
  });

  const payloadText = await response.text().catch(() => '');
  const payload = payloadText ? JSON.parse(payloadText) as MuxResponse<T> : null;

  if (!response.ok) {
    const message =
      (payload as { error?: { messages?: string[] } } | null)?.error?.messages?.[0] ||
      `Mux API request failed (${response.status})`;
    throw new Error(message);
  }

  if (!payload || !payload.data) {
    throw new Error('Mux API response missing data payload');
  }

  return payload.data;
};

export const createMuxAssetFromUrl = async (params: {
  inputUrl: string;
  playbackPolicy?: 'public' | 'signed';
  passthrough?: string;
  mp4Support?: 'none' | 'capped-1080p' | 'audio-only';
}) => {
  const playbackPolicy = params.playbackPolicy || 'public';
  const mp4Support = params.mp4Support || 'capped-1080p';

  return muxFetch<MuxAsset>('/assets', {
    method: 'POST',
    body: JSON.stringify({
      input: params.inputUrl,
      playback_policy: [playbackPolicy],
      passthrough: params.passthrough,
      mp4_support: mp4Support,
      master_access: 'none',
    }),
  });
};

export const getMuxAsset = async (assetId: string) => {
  return muxFetch<MuxAsset>(`/assets/${encodeURIComponent(assetId)}`, {
    method: 'GET',
  });
};

