import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { buildAnimatedWebpFromFrames } from '@/server/animatedWebpService';

const mocks = vi.hoisted(() => ({
  fetchCloudflareImage: vi.fn(),
  getCloudflareCredentials: vi.fn(),
  fetchOriginalImageBlob: vi.fn(),
  getImageExtrasRecord: vi.fn(),
  uploadImageBuffer: vi.fn(),
}));

vi.mock('@/server/cloudflareClient', () => ({
  fetchCloudflareImage: mocks.fetchCloudflareImage,
  getCloudflareCredentials: mocks.getCloudflareCredentials,
}));
vi.mock('@/server/animatedWebpService', async () => {
  const actual = await vi.importActual<typeof import('@/server/animatedWebpService')>(
    '@/server/animatedWebpService'
  );
  return { ...actual, fetchOriginalImageBlob: mocks.fetchOriginalImageBlob };
});
vi.mock('@/server/imageExtras', () => ({ getImageExtrasRecord: mocks.getImageExtrasRecord }));
vi.mock('@/server/uploadService', () => ({ uploadImageBuffer: mocks.uploadImageBuffer }));

import { rotateCloudflareImage } from '@/server/imageRotationService';

describe('image rotation workflow', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCloudflareCredentials.mockReturnValue({ accountId: 'account', apiToken: 'token' });
    mocks.fetchCloudflareImage.mockResolvedValue({
      id: 'source-image',
      filename: 'source.webp',
      variants: ['https://example.com/public'],
      uploaded: '2026-07-10T00:00:00.000Z',
      meta: {
        namespace: 'test-space',
        variationParentId: 'canonical-parent',
        tags: ['animation'],
        isAnimated: true,
      },
    });
    mocks.getImageExtrasRecord.mockResolvedValue({
      folder: 'motion',
      description: 'Animated source',
      originalUrl: 'https://source.example/original',
      sourceUrl: 'https://source.example/page',
    });
    mocks.uploadImageBuffer.mockResolvedValue({
      ok: true,
      data: {
        id: 'rotated-image',
        filename: 'source-rotated-90.webp',
        url: 'https://example.com/rotated',
        variants: ['https://example.com/rotated'],
        uploaded: '2026-07-11T00:00:00.000Z',
        tags: ['animation'],
        namespace: 'test-space',
        parentId: 'canonical-parent',
      },
    });
  });

  it('uses the original blob and uploads an animated family derivative', async () => {
    const frame = (color: string) => sharp({
      create: { width: 3, height: 2, channels: 4, background: color },
    }).png().toBuffer();
    const frames = await Promise.all([frame('#f00'), frame('#0f0')]);
    const animated = await buildAnimatedWebpFromFrames(
      frames.map((buffer) => ({ buffer })),
      { delays: [100, 200] }
    );
    mocks.fetchOriginalImageBlob.mockResolvedValue({
      buffer: animated.buffer,
      contentType: 'image/webp',
    });

    const result = await rotateCloudflareImage('source-image', 90);

    expect(mocks.fetchOriginalImageBlob).toHaveBeenCalledWith('source-image');
    expect(mocks.uploadImageBuffer).toHaveBeenCalledWith(expect.objectContaining({
      fileType: 'image/webp',
      context: expect.objectContaining({
        namespace: 'test-space',
        parentId: 'canonical-parent',
        rotatedFromId: 'source-image',
        rotationDegrees: 90,
        isAnimated: true,
      }),
    }));
    expect(result).toMatchObject({
      id: 'rotated-image',
      animated: true,
      frameCount: 2,
      parentId: 'canonical-parent',
    });
  });

  it('falls back to an animated delivery variant when blob access is forbidden', async () => {
    const frames = await Promise.all([
      sharp({ create: { width: 3, height: 2, channels: 4, background: '#f00' } }).png().toBuffer(),
      sharp({ create: { width: 3, height: 2, channels: 4, background: '#0f0' } }).png().toBuffer(),
    ]);
    const animated = await buildAnimatedWebpFromFrames(
      frames.map((buffer) => ({ buffer })),
      { delays: [100, 200] }
    );
    mocks.fetchOriginalImageBlob.mockRejectedValue(new Error('Failed to fetch original image blob (403)'));
    const deliveryFetch = vi.fn().mockResolvedValue(
      new Response(new Uint8Array(animated.buffer), { headers: { 'content-type': 'image/webp' } })
    );
    vi.stubGlobal('fetch', deliveryFetch);

    const result = await rotateCloudflareImage('source-image', 270);

    expect(deliveryFetch).toHaveBeenCalledWith(
      'https://example.com/public',
      expect.objectContaining({ cache: 'no-store' })
    );
    expect(result).toMatchObject({ animated: true, frameCount: 2, rotationDegrees: 270 });
  });

  it('refuses a still fallback for a known animated source', async () => {
    const still = await sharp({
      create: { width: 3, height: 2, channels: 4, background: '#f00' },
    }).png().toBuffer();
    mocks.fetchOriginalImageBlob.mockRejectedValue(new Error('Failed to fetch original image blob (403)'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(new Uint8Array(still), { headers: { 'content-type': 'image/png' } })
    ));

    await expect(rotateCloudflareImage('source-image', 90)).rejects.toThrow(
      'every delivery variant resolved to a still image'
    );
    expect(mocks.uploadImageBuffer).not.toHaveBeenCalled();
  });
});
