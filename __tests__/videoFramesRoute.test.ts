import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  getVideoAssetRecordWithSyncMock,
  probeVideoSourceMock,
  extractFrameBufferMock,
  buildFrameArchiveMock,
  resolveFrameSelectorMock,
  validateExtractFrameCountMock,
} = vi.hoisted(() => ({
  getVideoAssetRecordWithSyncMock: vi.fn(),
  probeVideoSourceMock: vi.fn(),
  extractFrameBufferMock: vi.fn(),
  buildFrameArchiveMock: vi.fn(),
  resolveFrameSelectorMock: vi.fn(),
  validateExtractFrameCountMock: vi.fn(),
}));

vi.mock('@/server/videoCatalogStorage', () => ({
  getVideoAssetRecordWithSync: getVideoAssetRecordWithSyncMock,
}));

vi.mock('@/server/videoFrameService', async () => {
  const actual = await vi.importActual<typeof import('@/server/videoFrameService')>('@/server/videoFrameService');
  return {
    ...actual,
    probeVideoSource: probeVideoSourceMock,
    extractFrameBuffer: extractFrameBufferMock,
    buildFrameArchive: buildFrameArchiveMock,
    resolveFrameSelector: resolveFrameSelectorMock,
    validateExtractFrameCount: validateExtractFrameCountMock,
  };
});

import { GET as GET_META } from '@/app/api/videos/[id]/frames/meta/route';
import { GET as GET_PREVIEW } from '@/app/api/videos/[id]/frames/preview/route';
import { POST as POST_EXTRACT } from '@/app/api/videos/[id]/frames/extract/route';

const ORIGINAL_ENV = { ...process.env };

const baseVideo = {
  id: 'video-1',
  filename: 'clip.mp4',
  uploaded: '2026-03-01T10:00:00.000Z',
  streamUid: 'stream-1',
  hlsUrl: 'https://videodelivery.net/stream-1/manifest/video.m3u8',
  videoStatus: 'ready' as const,
  tags: [],
};

const params = { params: Promise.resolve({ id: 'video-1' }) };

describe('video frame routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };

    getVideoAssetRecordWithSyncMock.mockResolvedValue(baseVideo);
    probeVideoSourceMock.mockResolvedValue({
      durationSeconds: 4,
      fps: 25,
      frameCount: 100,
      exactFrameCount: true,
    });
    extractFrameBufferMock.mockResolvedValue(Buffer.from('frame-bytes'));
    buildFrameArchiveMock.mockResolvedValue(Buffer.from('zip-bytes'));
    resolveFrameSelectorMock.mockReturnValue({ frames: [1, 100], invalid: [] });
    validateExtractFrameCountMock.mockReturnValue(undefined);
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('meta returns frame metadata and preview urls', async () => {
    const response = await GET_META(
      new NextRequest('http://localhost/api/videos/video-1/frames/meta'),
      params
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.frameCount).toBe(100);
    expect(payload.previews[0].previewUrl).toContain('/api/videos/video-1/frames/preview?frame=');
  });

  it('meta returns 503 with tooling hints when ffprobe is unavailable', async () => {
    probeVideoSourceMock.mockRejectedValueOnce(
      new Error('ffprobe is not installed or not available on PATH.')
    );

    const response = await GET_META(
      new NextRequest('http://localhost/api/videos/video-1/frames/meta'),
      params
    );
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.error).toMatch(/ffprobe is not installed/i);
    expect(payload.hints).toEqual(
      expect.arrayContaining([expect.stringMatching(/install ffmpeg/i)])
    );
  });

  it('preview returns the requested frame image', async () => {
    const response = await GET_PREVIEW(
      new NextRequest('http://localhost/api/videos/video-1/frames/preview?frame=25'),
      params
    );
    const body = Buffer.from(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('x-video-frame-number')).toBe('25');
    expect(body.equals(Buffer.from('frame-bytes'))).toBe(true);
    expect(extractFrameBufferMock).toHaveBeenCalledWith(
      expect.objectContaining({ frameNumber: 25, format: 'jpeg' })
    );
  });

  it('preview returns 409 when the video is not ready', async () => {
    getVideoAssetRecordWithSyncMock.mockResolvedValueOnce({
      ...baseVideo,
      videoStatus: 'pending',
    });

    const response = await GET_PREVIEW(
      new NextRequest('http://localhost/api/videos/video-1/frames/preview?frame=5'),
      params
    );
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error).toMatch(/not ready/i);
  });

  it('extract returns a single jpeg when one frame resolves', async () => {
    resolveFrameSelectorMock.mockReturnValueOnce({ frames: [7], invalid: [] });

    const response = await POST_EXTRACT(
      new NextRequest(
        new Request('http://localhost/api/videos/video-1/frames/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ selector: '7' }),
        })
      ),
      params
    );
    const body = Buffer.from(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('content-disposition')).toContain('clip-frame-000007.jpg');
    expect(body.equals(Buffer.from('frame-bytes'))).toBe(true);
  });

  it('extract returns a zip when multiple frames resolve', async () => {
    const response = await POST_EXTRACT(
      new NextRequest(
        new Request('http://localhost/api/videos/video-1/frames/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ selector: 'first,last' }),
        })
      ),
      params
    );
    const body = Buffer.from(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/zip');
    expect(response.headers.get('x-video-frame-numbers')).toBe('1,100');
    expect(body.equals(Buffer.from('zip-bytes'))).toBe(true);
    expect(buildFrameArchiveMock).toHaveBeenCalled();
  });

  it('extract returns 503 with tooling hints when ffmpeg is unavailable', async () => {
    extractFrameBufferMock.mockRejectedValueOnce(
      new Error('ffmpeg is not installed or not available on PATH.')
    );

    const response = await POST_EXTRACT(
      new NextRequest(
        new Request('http://localhost/api/videos/video-1/frames/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ selector: '7' }),
        })
      ),
      params
    );
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.error).toMatch(/ffmpeg is not installed/i);
    expect(payload.hints).toEqual(
      expect.arrayContaining([expect.stringMatching(/install ffmpeg/i)])
    );
  });
});
