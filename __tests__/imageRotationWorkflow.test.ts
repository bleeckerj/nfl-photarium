import { beforeEach, describe, expect, it, vi } from 'vitest';
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
});
