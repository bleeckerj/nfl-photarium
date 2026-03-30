import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  listCatalogAssetsMock,
  setAssetParentDirectlyWithAssetsMock,
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
    setAssetParentDirectlyWithAssetsMock: vi.fn(),
    ParentAssignmentErrorMock,
  };
});

vi.mock('@/server/assetCatalog', () => ({
  listCatalogAssets: listCatalogAssetsMock,
}));

vi.mock('@/server/assetParentService', () => ({
  setAssetParentDirectlyWithAssets: setAssetParentDirectlyWithAssetsMock,
  ParentAssignmentError: ParentAssignmentErrorMock,
}));

import { POST } from '@/app/api/images/[id]/swap-parent/route';

describe('POST /api/images/:id/swap-parent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENABLE_VIDEO_ASSETS = '0';
  });

  it('promotes the selected child before reparenting the old root', async () => {
    const assets = [
      { id: 'root', assetType: 'image', filename: 'root.png', uploaded: '2026-03-01T00:00:00.000Z' },
      { id: 'child-a', assetType: 'image', filename: 'a.png', uploaded: '2026-03-01T00:00:00.000Z', parentId: 'root' },
      { id: 'child-b', assetType: 'image', filename: 'b.png', uploaded: '2026-03-01T00:00:00.000Z', parentId: 'root' },
    ];
    listCatalogAssetsMock.mockResolvedValue(assets);

    setAssetParentDirectlyWithAssetsMock.mockImplementation(async (id: string, parentId: string) => ({
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
    expect(listCatalogAssetsMock).toHaveBeenCalledTimes(1);
    expect(listCatalogAssetsMock).toHaveBeenCalledWith({
      forceRefreshImages: false,
      includeVideos: false,
    });
    expect(setAssetParentDirectlyWithAssetsMock.mock.calls[0]).toEqual(['child-a', '', assets]);
    expect(setAssetParentDirectlyWithAssetsMock.mock.calls.slice(1).map(([id, parentId]) => [id, parentId])).toEqual(
      expect.arrayContaining([
        ['child-b', 'child-a'],
        ['root', 'child-a'],
      ])
    );
    for (const call of setAssetParentDirectlyWithAssetsMock.mock.calls) {
      expect(call[2]).toBe(assets);
    }
    expect(payload).toEqual(
      expect.objectContaining({
        success: true,
        requestedId: 'root',
        newParentId: 'child-a',
        concurrency: 12,
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

    setAssetParentDirectlyWithAssetsMock.mockRejectedValue(
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
    expect(setAssetParentDirectlyWithAssetsMock).toHaveBeenCalledTimes(1);
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

  it('returns partial failures after promotion succeeds in a larger family', async () => {
    const assets = [
      { id: 'root', assetType: 'image', filename: 'root.png', uploaded: '2026-03-01T00:00:00.000Z' },
      { id: 'child-a', assetType: 'image', filename: 'a.png', uploaded: '2026-03-01T00:00:00.000Z', parentId: 'root' },
      { id: 'child-b', assetType: 'image', filename: 'b.png', uploaded: '2026-03-01T00:00:00.000Z', parentId: 'root' },
      { id: 'child-c', assetType: 'image', filename: 'c.png', uploaded: '2026-03-01T00:00:00.000Z', parentId: 'root' },
    ];
    listCatalogAssetsMock.mockResolvedValue(assets);
    setAssetParentDirectlyWithAssetsMock.mockImplementation(async (id: string, parentId: string) => {
      if (id === 'child-c') {
        throw new ParentAssignmentErrorMock(504, 'timeout');
      }
      return {
        targetId: id,
        targetAssetType: 'image',
        parentId: parentId || undefined,
        canonicalParentId: parentId || undefined,
      };
    });

    const req = new NextRequest('http://localhost/api/images/root/swap-parent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newParentId: 'child-a' }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'root' }) });
    const payload = await res.json();

    expect(res.status).toBe(207);
    expect(listCatalogAssetsMock).toHaveBeenCalledTimes(1);
    expect(setAssetParentDirectlyWithAssetsMock).toHaveBeenCalledTimes(4);
    expect(payload).toEqual(
      expect.objectContaining({
        success: false,
        updated: ['child-a', 'child-b', 'root'],
        failed: [
          expect.objectContaining({
            id: 'child-c',
            parentId: 'child-a',
            status: 504,
          }),
        ],
      })
    );
  });

  it('retries with a force refresh when the cached catalog is stale', async () => {
    const staleAssets = [
      { id: 'root', assetType: 'image', filename: 'root.png', uploaded: '2026-03-01T00:00:00.000Z' },
    ];
    const freshAssets = [
      { id: 'root', assetType: 'image', filename: 'root.png', uploaded: '2026-03-01T00:00:00.000Z' },
      { id: 'child-a', assetType: 'image', filename: 'a.png', uploaded: '2026-03-01T00:00:00.000Z', parentId: 'root' },
    ];
    listCatalogAssetsMock
      .mockResolvedValueOnce(staleAssets)
      .mockResolvedValueOnce(freshAssets);
    setAssetParentDirectlyWithAssetsMock.mockResolvedValue({
      targetId: 'child-a',
      targetAssetType: 'image',
      canonicalParentId: undefined,
    });

    const req = new NextRequest('http://localhost/api/images/root/swap-parent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newParentId: 'child-a' }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'root' }) });

    expect(res.status).toBe(200);
    expect(listCatalogAssetsMock).toHaveBeenNthCalledWith(1, {
      forceRefreshImages: false,
      includeVideos: false,
    });
    expect(listCatalogAssetsMock).toHaveBeenNthCalledWith(2, {
      forceRefreshImages: true,
      includeVideos: false,
    });
    expect(setAssetParentDirectlyWithAssetsMock.mock.calls[0][2]).toBe(freshAssets);
  });
});
