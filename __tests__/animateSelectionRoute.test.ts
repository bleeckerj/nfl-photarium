import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/animate/selection/route';

const {
  getUploadDownloadInfoMock,
  uploadImageBufferMock,
  buildAnimatedWebpFromFramesMock,
  patchImageExtrasRecordMock,
} = vi.hoisted(() => ({
  getUploadDownloadInfoMock: vi.fn(),
  uploadImageBufferMock: vi.fn(),
  buildAnimatedWebpFromFramesMock: vi.fn(),
  patchImageExtrasRecordMock: vi.fn(),
}));

vi.mock('@/server/cloudflareUploadsService', () => ({
  getUploadDownloadInfo: getUploadDownloadInfoMock,
}));

vi.mock('@/server/uploadService', () => ({
  uploadImageBuffer: uploadImageBufferMock,
}));

vi.mock('@/server/animatedWebpService', () => ({
  buildAnimatedWebpFromFrames: buildAnimatedWebpFromFramesMock,
}));

vi.mock('@/server/imageExtras', () => ({
  patchImageExtrasRecord: patchImageExtrasRecordMock,
}));

const ORIGINAL_ENV = { ...process.env };

const createRequest = (body: Record<string, unknown>) =>
  new NextRequest(
    new Request('http://localhost/api/animate/selection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );

describe('POST /api/animate/selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct';
    process.env.CLOUDFLARE_API_TOKEN = 'token';

    getUploadDownloadInfoMock.mockImplementation(async (id: string) => ({
      url: `https://example.test/${id}.png`,
      filename: `${id}.png`,
      namespace: 'studio',
    }));
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200 }))
    );
    buildAnimatedWebpFromFramesMock.mockResolvedValue({
      buffer: Buffer.from('animated'),
      bytes: 8,
      width: 10,
      height: 10,
      frameCount: 3,
      delays: [100, 100, 100],
    });
    uploadImageBufferMock.mockResolvedValue({
      ok: true,
      data: {
        id: 'animated-1',
        filename: 'out.webp',
        url: 'https://imagedelivery.net/hash/animated-1/public',
        variants: ['https://imagedelivery.net/hash/animated-1/public'],
        uploaded: '2026-01-01T00:00:00.000Z',
        tags: ['animated-webp'],
      },
    });
  });

  it('preserves request id order and writes animation provenance', async () => {
    const response = await POST(createRequest({
      ids: ['img-b', 'img-a', 'img-c'],
      fps: 2,
      loop: false,
      filename: 'out',
      orderMode: 'reverse-gallery',
      namespace: 'studio',
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.id).toBe('animated-1');
    expect(getUploadDownloadInfoMock.mock.calls.map((call) => call[0])).toEqual([
      'img-b',
      'img-a',
      'img-c',
    ]);
    expect(buildAnimatedWebpFromFramesMock).toHaveBeenCalledWith(
      [
        expect.objectContaining({ filename: 'img-b.png' }),
        expect.objectContaining({ filename: 'img-a.png' }),
        expect.objectContaining({ filename: 'img-c.png' }),
      ],
      expect.objectContaining({ fps: 2, loop: false })
    );
    expect(patchImageExtrasRecordMock).toHaveBeenCalledWith(
      'animated-1',
      {
        animatedWebp: expect.objectContaining({
          sourceImageIds: ['img-b', 'img-a', 'img-c'],
          sourceFilenames: ['img-b.png', 'img-a.png', 'img-c.png'],
          orderMode: 'reverse-gallery',
          fps: 2,
          loop: false,
        }),
      }
    );
  });

  it('infers the upload namespace from selected images when browsing all namespaces', async () => {
    const response = await POST(createRequest({
      ids: ['img-a', 'img-b'],
      fps: 2,
      namespace: '__all__',
    }));

    expect(response.status).toBe(200);
    expect(uploadImageBufferMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ namespace: 'studio' }),
      })
    );
  });

  it('rejects all-namespace animation when selected images span multiple namespaces', async () => {
    getUploadDownloadInfoMock.mockImplementation(async (id: string) => ({
      url: `https://example.test/${id}.png`,
      filename: `${id}.png`,
      namespace: id === 'img-a' ? 'studio' : 'archive',
    }));

    const response = await POST(createRequest({
      ids: ['img-a', 'img-b'],
      fps: 2,
      namespace: '__all__',
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe(
      'Selected images span multiple namespaces. Select images from one namespace or switch to a specific namespace before creating an animation.'
    );
    expect(buildAnimatedWebpFromFramesMock).not.toHaveBeenCalled();
    expect(uploadImageBufferMock).not.toHaveBeenCalled();
  });
});
