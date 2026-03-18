import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  getVideoAssetRecordMock,
  resolveVideoDownloadUrlsMock,
  getStreamDownloadsMock,
  createStreamDownloadMock,
} = vi.hoisted(() => ({
  getVideoAssetRecordMock: vi.fn(),
  resolveVideoDownloadUrlsMock: vi.fn(),
  getStreamDownloadsMock: vi.fn(),
  createStreamDownloadMock: vi.fn(),
}));

vi.mock('@/server/videoCatalogStorage', () => ({
  getVideoAssetRecord: getVideoAssetRecordMock,
}));

vi.mock('@/server/videoDownloadUrl', () => ({
  resolveVideoDownloadUrls: resolveVideoDownloadUrlsMock,
}));

vi.mock('@/server/cloudflareStreamClient', () => ({
  getStreamDownloads: getStreamDownloadsMock,
  createStreamDownload: createStreamDownloadMock,
}));

import { GET } from '@/app/api/videos/[id]/download/route';

describe('GET /api/videos/[id]/download', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getStreamDownloadsMock.mockResolvedValue({});
    createStreamDownloadMock.mockResolvedValue({});
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('video-bytes', {
          status: 200,
          headers: {
            'content-type': 'video/mp4',
            'content-length': '11',
          },
        })
      )
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('streams attachment when downloadable URL is available', async () => {
    getVideoAssetRecordMock.mockResolvedValue({
      id: 'vid-1',
      filename: 'clip.mp4',
    });
    resolveVideoDownloadUrlsMock.mockReturnValue(['https://videodelivery.net/abc/downloads/default.mp4']);

    const req = new NextRequest('http://localhost/api/videos/vid-1/download');
    const res = await GET(req, { params: Promise.resolve({ id: 'vid-1' }) });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('attachment');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://videodelivery.net/abc/downloads/default.mp4',
      {
        cache: 'no-store',
        headers: {
          Accept: 'video/*,application/octet-stream;q=0.9,*/*;q=0.1',
        },
      }
    );
  });

  it('returns 404 when no downloadable URL is available', async () => {
    getVideoAssetRecordMock.mockResolvedValue({
      id: 'vid-1',
      filename: 'clip.mp4',
    });
    resolveVideoDownloadUrlsMock.mockReturnValue([]);

    const req = new NextRequest('http://localhost/api/videos/vid-1/download');
    const res = await GET(req, { params: Promise.resolve({ id: 'vid-1' }) });
    const payload = await res.json();

    expect(res.status).toBe(404);
    expect(payload.error).toMatch(/downloadable/i);
  });

  it('returns 409 when stream download generation is in progress', async () => {
    getVideoAssetRecordMock.mockResolvedValue({
      id: 'vid-1',
      filename: 'clip.mp4',
      streamUid: 'abc123',
    });
    resolveVideoDownloadUrlsMock.mockReturnValue([]);
    getStreamDownloadsMock.mockResolvedValue({
      default: { status: 'inprogress' },
    });
    createStreamDownloadMock.mockResolvedValue({
      status: 'inprogress',
    });

    const req = new NextRequest('http://localhost/api/videos/vid-1/download');
    const res = await GET(req, { params: Promise.resolve({ id: 'vid-1' }) });
    const payload = await res.json();

    expect(res.status).toBe(409);
    expect(payload.error).toMatch(/prepared/i);
  });

  it('returns probe ready status without streaming bytes', async () => {
    getVideoAssetRecordMock.mockResolvedValue({
      id: 'vid-1',
      filename: 'clip.mp4',
    });
    resolveVideoDownloadUrlsMock.mockReturnValue(['https://videodelivery.net/abc/downloads/default.mp4']);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(null, {
          status: 200,
          headers: {
            'content-type': 'video/mp4',
            'content-length': '100',
          },
        })
      )
    );

    const req = new NextRequest('http://localhost/api/videos/vid-1/download?probe=1');
    const res = await GET(req, { params: Promise.resolve({ id: 'vid-1' }) });
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.status).toBe('ready');
    expect(payload.ready).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://videodelivery.net/abc/downloads/default.mp4',
      {
        method: 'HEAD',
        cache: 'no-store',
        headers: {
          Accept: 'video/*,application/octet-stream;q=0.9,*/*;q=0.1',
        },
      }
    );
  });

  it('returns probe preparing status when stream download is in progress', async () => {
    getVideoAssetRecordMock.mockResolvedValue({
      id: 'vid-1',
      filename: 'clip.mp4',
      streamUid: 'abc123',
    });
    resolveVideoDownloadUrlsMock.mockReturnValue([]);
    getStreamDownloadsMock.mockResolvedValue({
      default: { status: 'inprogress' },
    });
    createStreamDownloadMock.mockResolvedValue({
      status: 'inprogress',
    });

    const req = new NextRequest('http://localhost/api/videos/vid-1/download?probe=1');
    const res = await GET(req, { params: Promise.resolve({ id: 'vid-1' }) });
    const payload = await res.json();

    expect(res.status).toBe(409);
    expect(payload.status).toBe('preparing');
    expect(payload.ready).toBe(false);
  });

  it('falls back to a later candidate when the first upstream URL 404s', async () => {
    getVideoAssetRecordMock.mockResolvedValue({
      id: 'vid-1',
      filename: 'clip.mp4',
    });
    resolveVideoDownloadUrlsMock.mockReturnValue([
      'https://old.example.com/abc/downloads/default.mp4',
      'https://videodelivery.net/abc/downloads/default.mp4',
    ]);
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(new Response('missing', { status: 404 }))
        .mockResolvedValueOnce(
          new Response('video-bytes', {
            status: 200,
            headers: {
              'content-type': 'video/mp4',
              'content-length': '11',
            },
          })
        )
    );

    const req = new NextRequest('http://localhost/api/videos/vid-1/download');
    const res = await GET(req, { params: Promise.resolve({ id: 'vid-1' }) });

    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      'https://old.example.com/abc/downloads/default.mp4',
      {
        cache: 'no-store',
        headers: {
          Accept: 'video/*,application/octet-stream;q=0.9,*/*;q=0.1',
        },
      }
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      'https://videodelivery.net/abc/downloads/default.mp4',
      {
        cache: 'no-store',
        headers: {
          Accept: 'video/*,application/octet-stream;q=0.9,*/*;q=0.1',
        },
      }
    );
  });

  it('skips non-video upstream responses even when status is 200', async () => {
    getVideoAssetRecordMock.mockResolvedValue({
      id: 'vid-1',
      filename: 'clip.mp4',
      streamUid: 'abc',
    });
    resolveVideoDownloadUrlsMock.mockReturnValue([
      'https://example.com/not-video',
      'https://videodelivery.net/abc/downloads/default.mp4',
    ]);
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(
          new Response('<html>not video</html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          })
        )
        .mockResolvedValueOnce(
          new Response('video-bytes', {
            status: 200,
            headers: { 'content-type': 'video/mp4' },
          })
        )
    );

    const req = new NextRequest('http://localhost/api/videos/vid-1/download');
    const res = await GET(req, { params: Promise.resolve({ id: 'vid-1' }) });

    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
