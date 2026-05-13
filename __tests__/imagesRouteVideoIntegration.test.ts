import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/images/route';

const {
  getCachedImagesMock,
  getCacheStatsMock,
  listVideoAssetRecordsWithSyncMock,
  getImageExtrasRecordsMock,
} = vi.hoisted(() => ({
  getCachedImagesMock: vi.fn(),
  getCacheStatsMock: vi.fn(),
  listVideoAssetRecordsWithSyncMock: vi.fn(),
  getImageExtrasRecordsMock: vi.fn(),
}));

vi.mock('@/server/cloudflareImageCache', () => ({
  getCachedImages: getCachedImagesMock,
  getCacheStats: getCacheStatsMock,
}));

vi.mock('@/server/vectorSearch', () => ({
  batchGetAspectMetadata: vi.fn(),
  batchGetColorMetadata: vi.fn(),
  isVectorSearchAvailable: vi.fn(),
}));

vi.mock('@/server/videoCatalogStorage', () => ({
  listVideoAssetRecordsWithSync: listVideoAssetRecordsWithSyncMock,
}));

vi.mock('@/server/imageExtras', () => ({
  getImageExtrasRecords: getImageExtrasRecordsMock,
}));

describe('GET /api/images video integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENABLE_VIDEO_ASSETS = '1';
    getCachedImagesMock.mockResolvedValue([
      {
        id: 'img-1',
        filename: 'photo.jpg',
        uploaded: '2026-02-20T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/img-1/public'],
        tags: [],
      },
    ]);
    getCacheStatsMock.mockReturnValue({ lastFetched: Date.now() });
    listVideoAssetRecordsWithSyncMock.mockResolvedValue([
      {
        id: 'vid-1',
        assetType: 'video',
        filename: 'clip.mp4',
        uploaded: '2026-02-20T01:00:00.000Z',
        parentId: 'img-1',
        streamUid: 'stream-uid',
        playbackUrl: 'https://videodelivery.net/stream-uid/iframe',
        hlsUrl: 'https://videodelivery.net/stream-uid/manifest/video.m3u8',
        thumbnailUrl: 'https://videodelivery.net/stream-uid/thumbnails/thumbnail.jpg',
        videoStatus: 'pending',
        tags: ['loop'],
        createdAt: '2026-02-20T01:00:00.000Z',
        updatedAt: '2026-02-20T01:00:00.000Z',
      },
    ]);
    getImageExtrasRecordsMock.mockResolvedValue({});
  });

  it('returns merged image and video assets', async () => {
    const response = await GET(new NextRequest('http://localhost/api/images'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.videoMeta).toEqual(
      expect.objectContaining({
        enabled: true,
        limit: expect.any(Number),
        returned: 1,
        totalScoped: 1,
        truncated: false,
      })
    );
    expect(payload.images).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'img-1' }),
        expect.objectContaining({
          id: 'vid-1',
          assetType: 'video',
          parentId: 'img-1',
          videoPlaybackUrl: 'https://videodelivery.net/stream-uid/iframe',
        }),
      ])
    );
  });

  it('applies videoLimit query and reports truncation metadata', async () => {
    listVideoAssetRecordsWithSyncMock.mockResolvedValue([
      {
        id: 'vid-1',
        assetType: 'video',
        filename: 'clip-1.mp4',
        uploaded: '2026-02-20T03:00:00.000Z',
        streamUid: 'stream-uid-1',
        playbackUrl: 'https://videodelivery.net/stream-uid-1/iframe',
        videoStatus: 'pending',
        tags: [],
        createdAt: '2026-02-20T03:00:00.000Z',
        updatedAt: '2026-02-20T03:00:00.000Z',
      },
      {
        id: 'vid-2',
        assetType: 'video',
        filename: 'clip-2.mp4',
        uploaded: '2026-02-20T02:00:00.000Z',
        streamUid: 'stream-uid-2',
        playbackUrl: 'https://videodelivery.net/stream-uid-2/iframe',
        videoStatus: 'pending',
        tags: [],
        createdAt: '2026-02-20T02:00:00.000Z',
        updatedAt: '2026-02-20T02:00:00.000Z',
      },
      {
        id: 'vid-3',
        assetType: 'video',
        filename: 'clip-3.mp4',
        uploaded: '2026-02-20T01:00:00.000Z',
        streamUid: 'stream-uid-3',
        playbackUrl: 'https://videodelivery.net/stream-uid-3/iframe',
        videoStatus: 'pending',
        tags: [],
        createdAt: '2026-02-20T01:00:00.000Z',
        updatedAt: '2026-02-20T01:00:00.000Z',
      },
    ]);

    const response = await GET(new NextRequest('http://localhost/api/images?videoLimit=2'));
    const payload = await response.json();
    const videoItems = payload.images.filter((entry: { assetType?: string }) => entry.assetType === 'video');

    expect(videoItems).toHaveLength(2);
    expect(payload.videoMeta).toEqual(
      expect.objectContaining({
        enabled: true,
        limit: 2,
        returned: 2,
        totalScoped: 3,
        truncated: true,
      })
    );
  });

  it('returns only videos when mediaFilter=animated and no animated webp images exist', async () => {
    getCachedImagesMock.mockResolvedValue([
      {
        id: 'img-1',
        filename: 'photo.jpg',
        uploaded: '2026-02-20T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/img-1/public'],
        tags: [],
      },
      {
        id: 'img-2',
        filename: 'still.webp',
        uploaded: '2026-02-19T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/img-2/public'],
        tags: ['preview'],
      },
    ]);

    const response = await GET(new NextRequest('http://localhost/api/images?mediaFilter=animated'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.images).toEqual([
      expect.objectContaining({
        id: 'vid-1',
        assetType: 'video',
      }),
    ]);
    expect(payload.pagination).toBeNull();
  });

  it('includes explicit animated webp images alongside videos for mediaFilter=animated', async () => {
    getCachedImagesMock.mockResolvedValue([
      {
        id: 'img-animated',
        filename: 'clip-preview.webp',
        uploaded: '2026-02-20T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/img-animated/public'],
        tags: ['animated-webp', 'video-derivative'],
      },
      {
        id: 'img-still',
        filename: 'still.png',
        uploaded: '2026-02-19T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/img-still/public'],
        tags: [],
      },
    ]);

    const response = await GET(new NextRequest('http://localhost/api/images?mediaFilter=animated'));
    const payload = await response.json();
    const ids = payload.images.map((entry: { id: string }) => entry.id);

    expect(response.status).toBe(200);
    expect(ids).toEqual(expect.arrayContaining(['img-animated', 'vid-1']));
    expect(ids).not.toContain('img-still');
  });

  it('excludes plain still webp images unless they use animated-webp conventions', async () => {
    getCachedImagesMock.mockResolvedValue([
      {
        id: 'img-still-webp',
        filename: 'poster.webp',
        uploaded: '2026-02-20T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/img-still-webp/public'],
        tags: ['poster'],
      },
      {
        id: 'img-derived-webp',
        filename: 'derived.webp',
        uploaded: '2026-02-19T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/img-derived-webp/public'],
        tags: ['video-derivative'],
      },
    ]);
    listVideoAssetRecordsWithSyncMock.mockResolvedValue([]);

    const response = await GET(new NextRequest('http://localhost/api/images?mediaFilter=animated'));
    const payload = await response.json();
    const ids = payload.images.map((entry: { id: string }) => entry.id);

    expect(response.status).toBe(200);
    expect(ids).toContain('img-derived-webp');
    expect(ids).not.toContain('img-still-webp');
  });

  it('includes legacy animated filename webps even when older uploads are missing animated tags', async () => {
    getCachedImagesMock.mockResolvedValue([
      {
        id: 'img-legacy-animated',
        filename: 'animated-1712345678901.webp',
        uploaded: '2026-02-20T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/img-legacy-animated/public'],
        tags: [],
      },
      {
        id: 'img-still-webp',
        filename: 'poster.webp',
        uploaded: '2026-02-19T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/img-still-webp/public'],
        tags: [],
      },
    ]);
    listVideoAssetRecordsWithSyncMock.mockResolvedValue([]);

    const response = await GET(new NextRequest('http://localhost/api/images?mediaFilter=animated'));
    const payload = await response.json();
    const ids = payload.images.map((entry: { id: string }) => entry.id);

    expect(response.status).toBe(200);
    expect(ids).toContain('img-legacy-animated');
    expect(ids).not.toContain('img-still-webp');
  });

  it('includes direct family members across namespaces when includeFamilyFor is provided', async () => {
    getCachedImagesMock.mockResolvedValue([
      {
        id: 'img-parent',
        filename: 'parent.jpg',
        namespace: 'alpha',
        uploaded: '2026-02-20T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/img-parent/public'],
        tags: [],
      },
      {
        id: 'img-child',
        filename: 'child.jpg',
        namespace: 'beta',
        parentId: 'img-parent',
        uploaded: '2026-02-20T00:05:00.000Z',
        variants: ['https://imagedelivery.net/hash/img-child/public'],
        tags: [],
      },
    ]);
    listVideoAssetRecordsWithSyncMock.mockResolvedValue([
      {
        id: 'vid-child',
        assetType: 'video',
        filename: 'child.mp4',
        namespace: 'gamma',
        parentId: 'img-parent',
        uploaded: '2026-02-20T00:10:00.000Z',
        streamUid: 'stream-uid-child',
        playbackUrl: 'https://videodelivery.net/stream-uid-child/iframe',
        videoStatus: 'pending',
        tags: [],
        createdAt: '2026-02-20T00:10:00.000Z',
        updatedAt: '2026-02-20T00:10:00.000Z',
      },
    ]);

    const response = await GET(
      new NextRequest('http://localhost/api/images?namespace=alpha&includeFamilyFor=img-parent')
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.images).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'img-parent', namespace: 'alpha' }),
        expect.objectContaining({ id: 'img-child', namespace: 'beta', parentId: 'img-parent' }),
        expect.objectContaining({ id: 'vid-child', namespace: 'gamma', parentId: 'img-parent' }),
      ])
    );
  });

  it('includes the current variant and its parent even when the namespace only matches the parent', async () => {
    getCachedImagesMock.mockResolvedValue([
      {
        id: 'img-parent',
        filename: 'parent.jpg',
        namespace: 'alpha',
        uploaded: '2026-02-20T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/img-parent/public'],
        tags: [],
      },
      {
        id: 'img-child',
        filename: 'child.jpg',
        namespace: 'beta',
        parentId: 'img-parent',
        uploaded: '2026-02-20T00:05:00.000Z',
        variants: ['https://imagedelivery.net/hash/img-child/public'],
        tags: [],
      },
    ]);
    listVideoAssetRecordsWithSyncMock.mockResolvedValue([]);

    const response = await GET(
      new NextRequest('http://localhost/api/images?namespace=alpha&includeFamilyFor=img-child')
    );
    const payload = await response.json();
    const ids = payload.images.map((entry: { id: string }) => entry.id);

    expect(response.status).toBe(200);
    expect(ids).toContain('img-parent');
    expect(ids).toContain('img-child');
  });

  it('keeps namespace scoping in place when mediaFilter=animated is requested', async () => {
    getCachedImagesMock.mockResolvedValue([
      {
        id: 'img-alpha',
        filename: 'alpha-preview.webp',
        namespace: 'alpha',
        uploaded: '2026-02-20T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/img-alpha/public'],
        tags: ['animated-webp'],
      },
      {
        id: 'img-beta',
        filename: 'beta-preview.webp',
        namespace: 'beta',
        uploaded: '2026-02-19T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/img-beta/public'],
        tags: ['animated-webp'],
      },
    ]);
    listVideoAssetRecordsWithSyncMock.mockResolvedValue([
      {
        id: 'vid-alpha',
        assetType: 'video',
        filename: 'alpha.mp4',
        namespace: 'alpha',
        uploaded: '2026-02-20T01:00:00.000Z',
        streamUid: 'stream-alpha',
        playbackUrl: 'https://videodelivery.net/stream-alpha/iframe',
        videoStatus: 'pending',
        tags: [],
        createdAt: '2026-02-20T01:00:00.000Z',
        updatedAt: '2026-02-20T01:00:00.000Z',
      },
      {
        id: 'vid-beta',
        assetType: 'video',
        filename: 'beta.mp4',
        namespace: 'beta',
        uploaded: '2026-02-20T02:00:00.000Z',
        streamUid: 'stream-beta',
        playbackUrl: 'https://videodelivery.net/stream-beta/iframe',
        videoStatus: 'pending',
        tags: [],
        createdAt: '2026-02-20T02:00:00.000Z',
        updatedAt: '2026-02-20T02:00:00.000Z',
      },
    ]);

    const response = await GET(
      new NextRequest('http://localhost/api/images?namespace=alpha&mediaFilter=animated')
    );
    const payload = await response.json();
    const ids = payload.images.map((entry: { id: string }) => entry.id);

    expect(response.status).toBe(200);
    expect(ids).toEqual(expect.arrayContaining(['img-alpha', 'vid-alpha']));
    expect(ids).not.toContain('img-beta');
    expect(ids).not.toContain('vid-beta');
  });

  it('applies extras description/altText to image list payload', async () => {
    getCachedImagesMock.mockResolvedValue([
      {
        id: 'img-1',
        filename: 'photo.jpg',
        uploaded: '2026-02-20T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/img-1/public'],
        tags: [],
        description: 'Cloudflare mirrored description',
        altTag: 'Cloudflare alt',
      },
    ]);
    listVideoAssetRecordsWithSyncMock.mockResolvedValue([]);
    getImageExtrasRecordsMock.mockResolvedValue({
      'img-1': {
        schemaVersion: 1,
        imageId: 'img-1',
        description: 'Detailed extras description',
        altText: 'Detailed extras alt text',
        createdAt: '2026-02-20T00:00:00.000Z',
        updatedAt: '2026-02-20T00:00:00.000Z',
      },
    });

    const response = await GET(new NextRequest('http://localhost/api/images?includeExtras=1'));
    const payload = await response.json();
    const image = payload.images.find((entry: { id: string }) => entry.id === 'img-1');

    expect(response.status).toBe(200);
    expect(image).toEqual(
      expect.objectContaining({
        description: 'Detailed extras description',
        altTag: 'Detailed extras alt text',
        altText: 'Detailed extras alt text',
      })
    );
  });

  it('does not hydrate extras unless includeExtras=1 is requested', async () => {
    getCachedImagesMock.mockResolvedValue([
      {
        id: 'img-1',
        filename: 'photo.jpg',
        uploaded: '2026-02-20T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/img-1/public'],
        tags: [],
        description: 'Cloudflare mirrored description',
        altTag: 'Cloudflare alt',
      },
    ]);
    listVideoAssetRecordsWithSyncMock.mockResolvedValue([]);
    getImageExtrasRecordsMock.mockResolvedValue({
      'img-1': {
        schemaVersion: 1,
        imageId: 'img-1',
        description: 'Detailed extras description',
        altText: 'Detailed extras alt text',
        createdAt: '2026-02-20T00:00:00.000Z',
        updatedAt: '2026-02-20T00:00:00.000Z',
      },
    });

    const response = await GET(new NextRequest('http://localhost/api/images'));
    const payload = await response.json();
    const image = payload.images.find((entry: { id: string }) => entry.id === 'img-1');

    expect(response.status).toBe(200);
    expect(payload.includeExtras).toBe(false);
    expect(getImageExtrasRecordsMock).not.toHaveBeenCalled();
    expect(image).toEqual(
      expect.objectContaining({
        description: 'Cloudflare mirrored description',
        altTag: 'Cloudflare alt',
      })
    );
    expect(image.altText).toBeUndefined();
  });

  it('applies pagination only when page/pageSize are provided', async () => {
    getCachedImagesMock.mockResolvedValue([
      {
        id: 'img-1',
        filename: 'photo-1.jpg',
        uploaded: '2026-02-20T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/img-1/public'],
        tags: [],
      },
      {
        id: 'img-2',
        filename: 'photo-2.jpg',
        uploaded: '2026-02-19T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/img-2/public'],
        tags: [],
      },
      {
        id: 'img-3',
        filename: 'photo-3.jpg',
        uploaded: '2026-02-18T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/img-3/public'],
        tags: [],
      },
    ]);
    listVideoAssetRecordsWithSyncMock.mockResolvedValue([]);

    const response = await GET(new NextRequest('http://localhost/api/images?page=2&pageSize=1'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.images).toHaveLength(1);
    expect(payload.images[0].id).toBe('img-2');
    expect(payload.pagination).toEqual(
      expect.objectContaining({
        page: 2,
        pageSize: 1,
        total: 3,
        totalPages: 3,
      })
    );
  });

  it('returns page-sized server gallery query payloads with facets and summaries', async () => {
    getCachedImagesMock.mockResolvedValue([
      {
        id: 'img-parent',
        filename: 'blue-chair.jpg',
        displayName: 'Blue chair',
        folder: 'editorial',
        uploaded: '2026-02-20T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/img-parent/public'],
        tags: ['hero'],
      },
      {
        id: 'img-child',
        filename: 'blue-chair-variant.jpg',
        folder: 'editorial',
        parentId: 'img-parent',
        uploaded: '2026-02-19T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/img-child/public'],
        tags: ['detail'],
      },
      {
        id: 'img-archive',
        filename: 'archive.jpg',
        folder: 'archive',
        uploaded: '2026-02-18T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/img-archive/public'],
        tags: ['hero'],
      },
    ]);
    listVideoAssetRecordsWithSyncMock.mockResolvedValue([]);

    const response = await GET(
      new NextRequest('http://localhost/api/images?page=1&pageSize=1&search=blue&folder=editorial&onlyWithVariants=1')
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.images).toHaveLength(1);
    expect(payload.images[0].id).toBe('img-parent');
    expect(payload.pagination).toEqual(
      expect.objectContaining({
        page: 1,
        pageSize: 1,
        total: 1,
        totalPages: 1,
      })
    );
    expect(payload.facets.folders).toEqual([
      { value: 'archive', count: 1 },
      { value: 'editorial', count: 2 },
    ]);
    expect(payload.familySummaryMap['img-parent']).toEqual(
      expect.objectContaining({
        isVariant: false,
        variantCount: 1,
        childIds: ['img-child'],
      })
    );
  });

  it('returns all-namespace focus metadata and the focused asset page', async () => {
    getCachedImagesMock.mockResolvedValue([
      {
        id: 'global-newest',
        filename: 'global-newest.jpg',
        namespace: 'beta',
        uploaded: '2026-02-22T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/global-newest/public'],
        tags: [],
      },
      {
        id: 'global-target',
        filename: 'global-target.jpg',
        namespace: 'alpha',
        uploaded: '2026-02-21T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/global-target/public'],
        tags: [],
      },
      {
        id: 'global-oldest',
        filename: 'global-oldest.jpg',
        namespace: 'beta',
        uploaded: '2026-02-20T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/global-oldest/public'],
        tags: [],
      },
    ]);
    listVideoAssetRecordsWithSyncMock.mockResolvedValue([]);

    const response = await GET(
      new NextRequest('http://localhost/api/images?namespace=__all__&focus=global-target&page=1&pageSize=1')
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.images.map((image: { id: string }) => image.id)).toEqual(['global-target']);
    expect(payload.pagination).toEqual(
      expect.objectContaining({
        page: 2,
        pageSize: 1,
        total: 3,
        totalPages: 3,
      })
    );
    expect(payload.focus).toEqual({
      assetId: 'global-target',
      found: true,
      index: 1,
      ordinal: 2,
      page: 2,
      pageSize: 1,
      total: 3,
    });
  });

  it('returns namespace-scoped focus metadata after an asset moves namespaces', async () => {
    getCachedImagesMock.mockResolvedValue([
      {
        id: 'new-namespace-newer',
        filename: 'newer.jpg',
        namespace: 'new-space',
        uploaded: '2026-02-22T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/new-namespace-newer/public'],
        tags: [],
      },
      {
        id: 'moved-image',
        filename: 'moved.jpg',
        namespace: 'new-space',
        uploaded: '2026-02-21T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/moved-image/public'],
        tags: [],
      },
      {
        id: 'old-namespace-neighbor',
        filename: 'old.jpg',
        namespace: 'old-space',
        uploaded: '2026-02-20T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/old-namespace-neighbor/public'],
        tags: [],
      },
    ]);
    listVideoAssetRecordsWithSyncMock.mockResolvedValue([]);

    const response = await GET(
      new NextRequest('http://localhost/api/images?namespace=new-space&focus=moved-image&page=1&pageSize=1')
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.namespace).toBe('new-space');
    expect(payload.images.map((image: { id: string }) => image.id)).toEqual(['moved-image']);
    expect(payload.focus).toEqual({
      assetId: 'moved-image',
      found: true,
      index: 1,
      ordinal: 2,
      page: 2,
      pageSize: 1,
      total: 2,
    });
  });

  it('reports pagination totals after mediaFilter=animated is applied', async () => {
    getCachedImagesMock.mockResolvedValue([
      {
        id: 'img-animated-1',
        filename: 'animated-1.webp',
        uploaded: '2026-02-20T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/img-animated-1/public'],
        tags: ['animated-webp'],
      },
      {
        id: 'img-still',
        filename: 'still.jpg',
        uploaded: '2026-02-19T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/img-still/public'],
        tags: [],
      },
      {
        id: 'img-animated-2',
        filename: 'animated-2.webp',
        uploaded: '2026-02-18T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/img-animated-2/public'],
        tags: ['video-derivative'],
      },
    ]);
    listVideoAssetRecordsWithSyncMock.mockResolvedValue([]);

    const response = await GET(
      new NextRequest('http://localhost/api/images?mediaFilter=animated&page=2&pageSize=1')
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.images).toHaveLength(1);
    expect(payload.pagination).toEqual(
      expect.objectContaining({
        page: 2,
        pageSize: 1,
        total: 2,
        totalPages: 2,
      })
    );
  });
});
