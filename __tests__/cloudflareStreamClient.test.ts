import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createStreamVideoFromFile,
  createStreamVideoFromUrl,
  deleteStreamVideo,
  getCloudflareStreamCredentials,
} from '@/server/cloudflareStreamClient';

const ORIGINAL_ENV = { ...process.env };

describe('cloudflareStreamClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct-123';
    process.env.CLOUDFLARE_STREAM_API_TOKEN = 'stream-token';
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('reads credentials and falls back to CLOUDFLARE_API_TOKEN', () => {
    delete process.env.CLOUDFLARE_STREAM_API_TOKEN;
    process.env.CLOUDFLARE_API_TOKEN = 'fallback-token';
    const credentials = getCloudflareStreamCredentials();
    expect(credentials.accountId).toBe('acct-123');
    expect(credentials.apiToken).toBe('fallback-token');
  });

  it('uploads file videos via Stream API', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          result: {
            uid: 'uid-file-1',
            readyToStream: false,
          },
        }),
        { status: 200 }
      )
    );

    const result = await createStreamVideoFromFile({
      buffer: Buffer.from('video-file'),
      fileName: 'clip.mp4',
      contentType: 'video/mp4',
      meta: { filename: 'clip.mp4' },
    });

    expect(result.uid).toBe('uid-file-1');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/accounts/acct-123/stream',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer stream-token',
        }),
      })
    );
  });

  it('creates remote stream copy jobs via /copy', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          result: {
            uid: 'uid-copy-1',
            readyToStream: true,
          },
        }),
        { status: 200 }
      )
    );

    const result = await createStreamVideoFromUrl({
      sourceUrl: 'https://cdn.example.com/loop.mp4',
    });

    expect(result.uid).toBe('uid-copy-1');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/accounts/acct-123/stream/copy',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer stream-token',
          'Content-Type': 'application/json',
        }),
      })
    );
  });

  it('bubbles Stream API error messages', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          errors: [{ message: 'Bad stream request' }],
        }),
        { status: 400 }
      )
    );

    await expect(
      createStreamVideoFromUrl({
        sourceUrl: 'https://cdn.example.com/loop.mp4',
      })
    ).rejects.toThrow('Bad stream request');
  });

  it('accepts empty successful delete responses from Stream API', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 204 })
    );

    await expect(deleteStreamVideo('uid-delete-1')).resolves.toBeUndefined();
  });
});
