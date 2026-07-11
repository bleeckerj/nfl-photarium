import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { rotateVideoAssetMock } = vi.hoisted(() => ({ rotateVideoAssetMock: vi.fn() }));

vi.mock('@/server/videoRotationService', async () => {
  const actual = await vi.importActual<typeof import('@/server/videoRotationService')>(
    '@/server/videoRotationService'
  );
  return { ...actual, rotateVideoAsset: rotateVideoAssetMock };
});

import { POST } from '@/app/api/videos/[id]/rotate/route';
import { VideoRotationError } from '@/server/videoRotationService';

describe('video rotate route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rotateVideoAssetMock.mockResolvedValue({
      id: 'rotated-video',
      filename: 'clip-rotated-90.mp4',
      videoStatus: 'pending',
      rotatedFromId: 'video-1',
      rotationDegrees: 90,
    });
  });

  it('rejects a zero-degree request', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/videos/video-1/rotate', {
        method: 'POST', body: JSON.stringify({ degrees: 0 }),
      }),
      { params: Promise.resolve({ id: 'video-1' }) }
    );
    expect(response.status).toBe(400);
    expect(rotateVideoAssetMock).not.toHaveBeenCalled();
  });

  it('returns 409 while the Stream download is preparing', async () => {
    rotateVideoAssetMock.mockRejectedValue(
      new VideoRotationError('Video download is being prepared. Retry rotation in a few seconds.', 409)
    );
    const response = await POST(
      new NextRequest('http://localhost/api/videos/video-1/rotate', {
        method: 'POST', body: JSON.stringify({ degrees: 90 }),
      }),
      { params: Promise.resolve({ id: 'video-1' }) }
    );
    expect(response.status).toBe(409);
  });

  it('returns the new non-destructive derivative', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/videos/video-1/rotate', {
        method: 'POST', body: JSON.stringify({ degrees: 90 }),
      }),
      { params: Promise.resolve({ id: 'video-1' }) }
    );
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(rotateVideoAssetMock).toHaveBeenCalledWith('video-1', 90);
    expect(payload.video).toMatchObject({ id: 'rotated-video', rotatedFromId: 'video-1' });
  });
});
