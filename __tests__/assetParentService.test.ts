import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getCachedImagesMock,
  upsertCachedImageMock,
  getCloudflareCredentialsMock,
  listCatalogAssetsMock,
  updateVideoAssetRecordMock,
  getVideoAssetRecordMock,
} = vi.hoisted(() => ({
  getCachedImagesMock: vi.fn(),
  upsertCachedImageMock: vi.fn(),
  getCloudflareCredentialsMock: vi.fn(),
  listCatalogAssetsMock: vi.fn(),
  updateVideoAssetRecordMock: vi.fn(),
  getVideoAssetRecordMock: vi.fn(),
}));

vi.mock('@/server/cloudflareImageCache', () => ({
  getCachedImages: getCachedImagesMock,
  upsertCachedImage: upsertCachedImageMock,
}));

vi.mock('@/server/cloudflareClient', () => ({
  getCloudflareCredentials: getCloudflareCredentialsMock,
}));

vi.mock('@/server/assetCatalog', () => ({
  listCatalogAssets: listCatalogAssetsMock,
}));

vi.mock('@/server/videoCatalogStorage', () => ({
  updateVideoAssetRecord: updateVideoAssetRecordMock,
  getVideoAssetRecord: getVideoAssetRecordMock,
}));

import { assignAssetParent } from '@/server/assetParentService';

describe('assignAssetParent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENABLE_VIDEO_ASSETS = '1';

    getCloudflareCredentialsMock.mockReturnValue({
      accountId: 'acct-1',
      apiToken: 'token-1',
    });

    getCachedImagesMock.mockResolvedValue([
      {
        id: 'child-image',
        filename: 'child.webp',
        uploaded: '2026-03-01T00:00:00.000Z',
        variants: [],
        tags: [],
      },
    ]);

    updateVideoAssetRecordMock.mockImplementation(async (id: string, patch: Record<string, unknown>) => ({
      id,
      ...patch,
    }));

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('re-parents existing video children when assigning a video to an image parent', async () => {
    listCatalogAssetsMock.mockResolvedValue([
      {
        id: 'image-parent',
        assetType: 'image',
        filename: 'parent.png',
        uploaded: '2026-03-01T00:00:00.000Z',
      },
      {
        id: 'video-target',
        assetType: 'video',
        filename: 'target.mp4',
        uploaded: '2026-03-01T00:00:00.000Z',
      },
      {
        id: 'child-image',
        assetType: 'image',
        filename: 'child.webp',
        uploaded: '2026-03-01T00:00:00.000Z',
        parentId: 'video-target',
      },
      {
        id: 'child-video',
        assetType: 'video',
        filename: 'child.mp4',
        uploaded: '2026-03-01T00:00:00.000Z',
        parentId: 'video-target',
      },
    ]);

    const result = await assignAssetParent('video-target', 'image-parent');

    expect(updateVideoAssetRecordMock).toHaveBeenCalledWith('child-video', { parentId: 'image-parent' });
    expect(updateVideoAssetRecordMock).toHaveBeenCalledWith('video-target', { parentId: 'image-parent' });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/images/v1/child-image'),
      expect.objectContaining({ method: 'PATCH' })
    );
    expect(upsertCachedImageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'child-image',
        parentId: 'image-parent',
      })
    );
    expect(result.reparentedChildIds).toEqual(['child-image', 'child-video']);
    expect(result.parentId).toBe('image-parent');
  });

  it('still blocks image targets that already have children', async () => {
    listCatalogAssetsMock.mockResolvedValue([
      {
        id: 'image-parent-2',
        assetType: 'image',
        filename: 'parent2.png',
        uploaded: '2026-03-01T00:00:00.000Z',
      },
      {
        id: 'image-target',
        assetType: 'image',
        filename: 'target.png',
        uploaded: '2026-03-01T00:00:00.000Z',
      },
      {
        id: 'child-image',
        assetType: 'image',
        filename: 'child.webp',
        uploaded: '2026-03-01T00:00:00.000Z',
        parentId: 'image-target',
      },
    ]);

    await expect(assignAssetParent('image-target', 'image-parent-2')).rejects.toThrow(
      /already has variations/i
    );
  });

  it('allows assigning an image variant directly to a canonical video root', async () => {
    listCatalogAssetsMock.mockResolvedValue([
      {
        id: 'video-root',
        assetType: 'video',
        filename: 'root.mp4',
        uploaded: '2026-03-01T00:00:00.000Z',
      },
      {
        id: 'image-child',
        assetType: 'image',
        filename: 'child.webp',
        uploaded: '2026-03-01T00:00:00.000Z',
      },
    ]);

    const result = await assignAssetParent('image-child', 'video-root');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/images/v1/image-child'),
      expect.objectContaining({
        method: 'PATCH',
        body: expect.stringContaining('video-root'),
      })
    );
    expect(result.parentId).toBe('video-root');
    expect(result.canonicalParentId).toBe('video-root');
  });
});
