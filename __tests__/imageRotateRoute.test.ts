import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { rotateCloudflareImageMock } = vi.hoisted(() => ({
  rotateCloudflareImageMock: vi.fn(),
}));

vi.mock('@/server/imageRotationService', async () => {
  const actual = await vi.importActual<typeof import('@/server/imageRotationService')>(
    '@/server/imageRotationService'
  );
  return { ...actual, rotateCloudflareImage: rotateCloudflareImageMock };
});

import { POST } from '@/app/api/images/[id]/rotate/route';

describe('image rotate route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rotateCloudflareImageMock.mockResolvedValue({
      id: 'rotated-1',
      filename: 'source-rotated-90.webp',
      url: 'https://example.com/rotated.webp',
      variants: [],
      animated: true,
      frameCount: 3,
      delaysPreserved: true,
      width: 20,
      height: 30,
      contentType: 'image/webp',
      extension: 'webp',
      buffer: Buffer.from('test'),
      rotatedFromId: 'source-1',
      rotatedAt: '2026-07-11T00:00:00.000Z',
      rotationDegrees: 90,
    });
  });

  it('rejects arbitrary angles', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/images/source-1/rotate', {
        method: 'POST', body: JSON.stringify({ degrees: 45 }),
      }),
      { params: Promise.resolve({ id: 'source-1' }) }
    );
    expect(response.status).toBe(400);
    expect(rotateCloudflareImageMock).not.toHaveBeenCalled();
  });

  it('returns preserved animation details', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/images/source-1/rotate', {
        method: 'POST', body: JSON.stringify({ direction: 'right' }),
      }),
      { params: Promise.resolve({ id: 'source-1' }) }
    );
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(rotateCloudflareImageMock).toHaveBeenCalledWith('source-1', 90);
    expect(payload).toMatchObject({ animated: true, frameCount: 3, delaysPreserved: true });
    expect(payload.buffer).toBeUndefined();
  });
});
