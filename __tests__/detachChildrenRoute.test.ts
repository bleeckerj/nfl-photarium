import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  detachAssetChildrenMock,
  ParentAssignmentErrorMock,
} = vi.hoisted(() => {
  class ParentAssignmentErrorMock extends Error {
    status: number;

    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }

  return {
    detachAssetChildrenMock: vi.fn(),
    ParentAssignmentErrorMock,
  };
});

vi.mock('@/server/assetParentService', () => ({
  detachAssetChildren: detachAssetChildrenMock,
  ParentAssignmentError: ParentAssignmentErrorMock,
}));

import { POST } from '@/app/api/images/[id]/detach-children/route';

describe('POST /api/images/:id/detach-children', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENABLE_VIDEO_ASSETS = '1';
  });

  it('detaches every direct child in the family, including videos', async () => {
    detachAssetChildrenMock.mockResolvedValue({
      parentId: 'root',
      childIds: ['image-child', 'video-child'],
      detachedIds: ['image-child', 'video-child'],
      failed: [],
    });

    const req = new NextRequest('http://localhost/api/images/root/detach-children', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ concurrency: 4 }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'root' }) });
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(detachAssetChildrenMock).toHaveBeenCalledWith('root', {
      concurrency: 4,
      forceRefreshImages: true,
      includeVideos: true,
      requireCanonicalImageParent: true,
      dryRun: false,
    });
    expect(payload).toEqual(
      expect.objectContaining({
        success: true,
        requestedId: 'root',
        attempted: 2,
        detachedIds: ['image-child', 'video-child'],
        failed: [],
      })
    );
  });

  it('reports partial failures while finishing the batch', async () => {
    detachAssetChildrenMock.mockResolvedValue({
      parentId: 'root',
      childIds: ['image-child', 'video-child'],
      detachedIds: ['image-child'],
      failed: [
        { id: 'video-child', status: 502, message: 'Cloudflare parent update timed out' },
      ],
    });

    const req = new NextRequest('http://localhost/api/images/root/detach-children', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ concurrency: 4 }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'root' }) });
    const payload = await res.json();

    expect(res.status).toBe(207);
    expect(payload).toEqual(
      expect.objectContaining({
        success: false,
        detachedIds: ['image-child'],
        failed: [
          expect.objectContaining({
            id: 'video-child',
            status: 502,
          }),
        ],
      })
    );
  });
});
