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

import { POST } from '@/app/api/images/[id]/swap-parent/route';

describe('POST /api/images/:id/swap-parent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENABLE_VIDEO_ASSETS = '0';
  });

  it('promotes the selected child before reparenting the old root', async () => {
    listCatalogAssetsMock.mockResolvedValue([
      { id: 'root', assetType: 'image', filename: 'root.png', uploaded: '2026-03-01T00:00:00.000Z' },
      { id: 'child-a', assetType: 'image', filename: 'a.png', uploaded: '2026-03-01T00:00:00.000Z', parentId: 'root' },
      { id: 'child-b', assetType: 'image', filename: 'b.png', uploaded: '2026-03-01T00:00:00.000Z', parentId: 'root' },
    ]);

    setAssetParentDirectlyMock.mockImplementation(async (id: string, parentId: string) => ({
      targetId: id,
      targetAssetType: 'image',
      parentId: parentId || undefined,
      canonicalParentId: parentId || undefined,
    }));

    const req = new NextRequest('http://localhost/api/images/root/swap-parent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newParentId: 'child-a' }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'root' }) });
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(setAssetParentDirectlyMock.mock.calls).toEqual([
      ['child-a', '', { forceRefreshImages: true }],
      ['child-b', 'child-a', { forceRefreshImages: true }],
      ['root', 'child-a', { forceRefreshImages: true }],
    ]);
    expect(payload).toEqual(
      expect.objectContaining({
        success: true,
        requestedId: 'root',
        newParentId: 'child-a',
        updated: ['child-a', 'child-b', 'root'],
        failed: [],
      })
    );
  });

  it('returns immediately when promoting the new parent fails', async () => {
    listCatalogAssetsMock.mockResolvedValue([
      { id: 'root', assetType: 'image', filename: 'root.png', uploaded: '2026-03-01T00:00:00.000Z' },
      { id: 'child-a', assetType: 'image', filename: 'a.png', uploaded: '2026-03-01T00:00:00.000Z', parentId: 'root' },
    ]);

    setAssetParentDirectlyMock.mockRejectedValue(
      new ParentAssignmentErrorMock(502, 'Cloudflare parent update timed out')
    );

    const req = new NextRequest('http://localhost/api/images/root/swap-parent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newParentId: 'child-a' }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'root' }) });
    const payload = await res.json();

    expect(res.status).toBe(502);
    expect(setAssetParentDirectlyMock).toHaveBeenCalledTimes(1);
    expect(payload).toEqual(
      expect.objectContaining({
        success: false,
        updated: [],
        failed: [
          expect.objectContaining({
            id: 'child-a',
            parentId: '',
            status: 502,
          }),
        ],
      })
    );
  });
});
