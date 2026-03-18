import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  listCatalogAssetsMock,
  setAssetParentDirectlyMock,
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
    listCatalogAssetsMock: vi.fn(),
    setAssetParentDirectlyMock: vi.fn(),
    ParentAssignmentErrorMock,
  };
});

vi.mock('@/server/assetCatalog', () => ({
  listCatalogAssets: listCatalogAssetsMock,
}));

vi.mock('@/server/assetParentService', () => ({
  setAssetParentDirectly: setAssetParentDirectlyMock,
  ParentAssignmentError: ParentAssignmentErrorMock,
}));

import { POST } from '@/app/api/images/[id]/detach-children/route';

describe('POST /api/images/:id/detach-children', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENABLE_VIDEO_ASSETS = '1';
  });

  it('detaches every direct child in the family, including videos', async () => {
    listCatalogAssetsMock.mockResolvedValue([
      { id: 'root', assetType: 'image', filename: 'root.png', uploaded: '2026-03-01T00:00:00.000Z' },
      { id: 'image-child', assetType: 'image', filename: 'a.png', uploaded: '2026-03-01T00:00:00.000Z', parentId: 'root' },
      { id: 'video-child', assetType: 'video', filename: 'clip.mp4', uploaded: '2026-03-01T00:00:00.000Z', parentId: 'root' },
    ]);

    setAssetParentDirectlyMock.mockImplementation(async (id: string, parentId: string) => ({
      targetId: id,
      targetAssetType: id === 'video-child' ? 'video' : 'image',
      parentId: parentId || undefined,
      canonicalParentId: parentId || undefined,
    }));

    const req = new NextRequest('http://localhost/api/images/root/detach-children', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ concurrency: 4 }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'root' }) });
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(setAssetParentDirectlyMock.mock.calls).toEqual([
      ['image-child', '', { forceRefreshImages: true }],
      ['video-child', '', { forceRefreshImages: true }],
    ]);
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
    listCatalogAssetsMock.mockResolvedValue([
      { id: 'root', assetType: 'image', filename: 'root.png', uploaded: '2026-03-01T00:00:00.000Z' },
      { id: 'image-child', assetType: 'image', filename: 'a.png', uploaded: '2026-03-01T00:00:00.000Z', parentId: 'root' },
      { id: 'video-child', assetType: 'video', filename: 'clip.mp4', uploaded: '2026-03-01T00:00:00.000Z', parentId: 'root' },
    ]);

    setAssetParentDirectlyMock
      .mockResolvedValueOnce({
        targetId: 'image-child',
        targetAssetType: 'image',
      })
      .mockRejectedValueOnce(new ParentAssignmentErrorMock(502, 'Cloudflare parent update timed out'));

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
