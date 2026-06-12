import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/videos/[id]/animated-webp/route';

const {
  getVideoAssetRecordWithSyncMock,
  updateVideoAssetRecordMock,
  convertVideoToAnimatedWebpMock,
  uploadImageBufferMock,
} = vi.hoisted(() => ({
  getVideoAssetRecordWithSyncMock: vi.fn(),
  updateVideoAssetRecordMock: vi.fn(),
  convertVideoToAnimatedWebpMock: vi.fn(),
  uploadImageBufferMock: vi.fn(),
}));

vi.mock('@/server/videoCatalogStorage', () => ({
  getVideoAssetRecordWithSync: getVideoAssetRecordWithSyncMock,
  updateVideoAssetRecord: updateVideoAssetRecordMock,
}));

vi.mock('@/server/videoAnimatedWebpService', () => ({
  convertVideoToAnimatedWebp: convertVideoToAnimatedWebpMock,
}));

vi.mock('@/server/uploadService', () => ({
  uploadImageBuffer: uploadImageBufferMock,
}));

const ORIGINAL_ENV = { ...process.env };

const createRequest = (body?: Record<string, unknown>) =>
  new NextRequest(
    new Request('http://localhost/api/videos/video-1/animated-webp', {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
  );

const createParams = (id: string) => ({ params: Promise.resolve({ id }) });

const baseVideo = {
  id: 'video-1',
  filename: 'clip.mp4',
  generatedBy: 'comfyui',
  comfyMetadataDetected: true,
  comfyMetadataSource: 'video:prompt',
  uploaded: '2026-03-01T10:00:00.000Z',
  streamUid: 'stream-1',
  hlsUrl: 'https://videodelivery.net/stream-1/manifest/video.m3u8',
  videoStatus: 'ready' as const,
  folder: 'loops',
  tags: ['loop'],
  namespace: 'ns-a',
};

describe('POST /api/videos/[id]/animated-webp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct-1';
    process.env.CLOUDFLARE_API_TOKEN = 'token-1';

    getVideoAssetRecordWithSyncMock.mockResolvedValue(baseVideo);
    updateVideoAssetRecordMock.mockImplementation(async (_id, patch) => ({
      ...baseVideo,
      ...patch,
    }));

    convertVideoToAnimatedWebpMock.mockResolvedValue({
      buffer: Buffer.from('animated-webp-bytes'),
      bytes: 2048,
      width: 640,
      height: 360,
      fps: 12,
      loop: true,
      quality: 82,
      scale: 1,
      maxWidth: 960,
      maxHeight: 960,
      maxOutputBytes: 10 * 1024 * 1024,
      timeoutMs: 45000,
      attempts: 1,
    });

    uploadImageBufferMock.mockResolvedValue({
      ok: true,
      data: {
        id: 'img-1',
        filename: 'clip.webp',
        url: 'https://imagedelivery.net/hash/img-1/public',
        variants: ['https://imagedelivery.net/hash/img-1/public'],
        uploaded: '2026-03-01T10:00:10.000Z',
        tags: ['loop'],
      },
    });
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('returns 404 when video does not exist', async () => {
    getVideoAssetRecordWithSyncMock.mockResolvedValueOnce(null);

    const response = await POST(createRequest(), createParams('missing-id'));
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toMatch(/Video not found/i);
    expect(convertVideoToAnimatedWebpMock).not.toHaveBeenCalled();
  });

  it('returns 409 when video is not ready', async () => {
    getVideoAssetRecordWithSyncMock.mockResolvedValueOnce({
      ...baseVideo,
      videoStatus: 'pending',
    });

    const response = await POST(createRequest(), createParams('video-1'));
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error).toMatch(/not ready/i);
    expect(convertVideoToAnimatedWebpMock).not.toHaveBeenCalled();
  });

  it('returns 400 when namespace is missing', async () => {
    getVideoAssetRecordWithSyncMock.mockResolvedValueOnce({
      ...baseVideo,
      namespace: undefined,
    });

    const response = await POST(createRequest(), createParams('video-1'));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/missing namespace/i);
    expect(convertVideoToAnimatedWebpMock).not.toHaveBeenCalled();
  });

  it('propagates image upload failures', async () => {
    uploadImageBufferMock.mockResolvedValueOnce({
      ok: false,
      error: 'upload failed',
      status: 502,
      reason: 'upload',
    });

    const response = await POST(createRequest(), createParams('video-1'));
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload.error).toBe('upload failed');
    expect(updateVideoAssetRecordMock).toHaveBeenCalledWith(
      'video-1',
      expect.objectContaining({ animatedWebpStatus: 'error' })
    );
  });

  it('creates an animated webp derivative and stores metadata', async () => {
    const response = await POST(
      createRequest({ maxWidth: 720, maxHeight: 720, maxOutputBytes: 2_000_000, fps: 10 }),
      createParams('video-1')
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(convertVideoToAnimatedWebpMock).toHaveBeenCalledWith(
      baseVideo.hlsUrl,
      expect.objectContaining({
        maxWidth: 720,
        maxHeight: 720,
        maxOutputBytes: 2_000_000,
        fps: 10,
      })
    );
    expect(uploadImageBufferMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fileType: 'image/webp',
        context: expect.objectContaining({
          namespace: 'ns-a',
          tags: ['loop'],
          generatedBy: 'comfyui',
          comfyMetadataDetected: true,
          comfyMetadataSource: 'video:prompt',
        }),
      })
    );
    expect(updateVideoAssetRecordMock).toHaveBeenCalledWith(
      'video-1',
      expect.objectContaining({
        animatedWebpImageId: 'img-1',
        animatedWebpStatus: 'ready',
        animatedWebpUrl: '/api/images/img-1/download?variant=original&disposition=inline',
        animatedWebpBytes: 2048,
        animatedWebpVariants: expect.any(Array),
      })
    );
    expect(payload.animatedWebp.url).toBe('/api/images/img-1/download?variant=original&disposition=inline');
  });

  it('filters animated webp marker tags from generated image uploads', async () => {
    getVideoAssetRecordWithSyncMock.mockResolvedValueOnce({
      ...baseVideo,
      tags: ['loop', 'animated-webp', 'video-derivative', 'keep'],
    });

    const response = await POST(createRequest(), createParams('video-1'));
    await response.json();

    const uploadArg = uploadImageBufferMock.mock.calls[0]?.[0] as {
      context: { tags?: string[] };
    };
    expect(uploadArg.context.tags).toEqual(['loop', 'keep']);
  });

  it('supports generating multiple variations in one request', async () => {
    convertVideoToAnimatedWebpMock
      .mockResolvedValueOnce({
        buffer: Buffer.from('variant-1'),
        bytes: 4096,
        width: 720,
        height: 400,
        fps: 10,
        loop: true,
        quality: 82,
        scale: 1,
        maxWidth: 720,
        maxHeight: 720,
        maxOutputBytes: 2_000_000,
        timeoutMs: 45000,
        attempts: 1,
      })
      .mockResolvedValueOnce({
        buffer: Buffer.from('variant-2'),
        bytes: 3072,
        width: 640,
        height: 360,
        fps: 8,
        loop: false,
        quality: 76,
        scale: 0.92,
        maxWidth: 640,
        maxHeight: 640,
        maxOutputBytes: 1_000_000,
        timeoutMs: 45000,
        attempts: 2,
      });

    uploadImageBufferMock
      .mockResolvedValueOnce({
        ok: true,
        data: {
          id: 'img-a',
          filename: 'clip-v1.webp',
          url: 'https://imagedelivery.net/hash/img-a/public',
          variants: ['https://imagedelivery.net/hash/img-a/public'],
          uploaded: '2026-03-01T10:00:10.000Z',
          tags: ['loop'],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          id: 'img-b',
          filename: 'clip-v2.webp',
          url: 'https://imagedelivery.net/hash/img-b/public',
          variants: ['https://imagedelivery.net/hash/img-b/public'],
          uploaded: '2026-03-01T10:00:11.000Z',
          tags: ['loop'],
        },
      });

    const response = await POST(
      createRequest({
        variations: [
          { maxWidth: 720, maxOutputBytes: 2_000_000, fps: 10, loop: true, filename: 'clip-v1' },
          { maxWidth: 640, maxOutputBytes: 1_000_000, fps: 8, loop: false, filename: 'clip-v2' },
        ],
      }),
      createParams('video-1')
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.createdCount).toBe(2);
    expect(payload.failedCount).toBe(0);
    expect(payload.variations).toHaveLength(2);
    expect(convertVideoToAnimatedWebpMock).toHaveBeenCalledTimes(2);
    expect(uploadImageBufferMock).toHaveBeenCalledTimes(2);
  });

  it('returns troubleshooting hints when encoder support is missing', async () => {
    convertVideoToAnimatedWebpMock.mockRejectedValueOnce(
      new Error("ffmpeg exited with code 8: Unknown encoder 'libwebp'")
    );

    const response = await POST(createRequest(), createParams('video-1'));
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload.error).toMatch(/Unknown encoder/i);
    expect(payload.hints).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/missing WebP encoder support/i),
      ])
    );
  });
});
