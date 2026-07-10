import { afterEach, describe, expect, it, vi } from 'vitest';

describe('Flickr Photarium client', async () => {
  const { uploadVideoToPhotarium } = await import('../scripts/flickr-ingest/photarium-client.mjs');

  afterEach(() => vi.unstubAllGlobals());

  it('routes Flickr video bytes through the Photarium video endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'video-1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await uploadVideoToPhotarium({
      apiBase: 'http://localhost:3000',
      buffer: Buffer.from('video'),
      fileName: 'clip.mp4',
      contentType: 'video/mp4',
      metadata: {
        namespace: 'cf-flickr',
        folder: 'Clips',
        tags: ['flickr', 'video'],
        displayName: 'Clip',
        sourceUrl: 'https://www.flickr.com/photos/me/1/',
        originalUrl: 'https://example.com/clip.mp4',
      },
    });

    expect(result).toEqual(expect.objectContaining({ ok: true, payload: { id: 'video-1' } }));
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/import/page/upload-video',
      expect.objectContaining({ method: 'POST', body: expect.any(FormData) }),
    );
  });
});
