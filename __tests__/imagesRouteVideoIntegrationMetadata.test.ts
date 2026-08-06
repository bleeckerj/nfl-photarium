import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/images/route';
import { clearGalleryQueryScopeMemo } from '@/server/galleryQuery';

const {
  getCachedImagesMock,
  getCacheStatsMock,
  listVideoAssetRecordsWithSyncMock,
  getImageExtrasRecordsMock,
  getImageFolderOverridesMock,
  getImageFolderOverridesVersionMock,
  getImageExtrasSearchTextMock,
  batchGetAspectMetadataMock,
  batchGetColorMetadataMock,
  isVectorSearchAvailableMock,
  hydrateMissingAspectMetadataMock,
} = vi.hoisted(() => ({
  getCachedImagesMock: vi.fn(),
  getCacheStatsMock: vi.fn(),
  listVideoAssetRecordsWithSyncMock: vi.fn(),
  getImageExtrasRecordsMock: vi.fn(),
  getImageFolderOverridesMock: vi.fn<[], Promise<Map<string, string | undefined>>>(),
  getImageFolderOverridesVersionMock: vi.fn<[], number>(),
  getImageExtrasSearchTextMock: vi.fn<[], Promise<Map<string, string>>>(),
  batchGetAspectMetadataMock: vi.fn(),
  batchGetColorMetadataMock: vi.fn(),
  isVectorSearchAvailableMock: vi.fn(),
  hydrateMissingAspectMetadataMock: vi.fn(),
}));

vi.mock('@/server/cloudflareImageCache', () => ({
  getCachedImages: getCachedImagesMock,
  getCacheStats: getCacheStatsMock,
}));

vi.mock('@/server/vectorSearch', () => ({
  batchGetAspectMetadata: batchGetAspectMetadataMock,
  batchGetColorMetadata: batchGetColorMetadataMock,
  isVectorSearchAvailable: isVectorSearchAvailableMock,
}));

vi.mock('@/server/aspectMetadataHydration', () => ({
  hydrateMissingAspectMetadata: hydrateMissingAspectMetadataMock,
}));

vi.mock('@/server/videoCatalogStorage', () => ({
  listVideoAssetRecordsWithSync: listVideoAssetRecordsWithSyncMock,
  getVideoAssetCatalogVersion: () => 0,
}));

vi.mock('@/server/imageExtras', () => ({
  getImageExtrasRecords: getImageExtrasRecordsMock,
  // Fix 1 / Fix 2 (perf): route reads the folder-override map and its
  // version on every request. Tests set these per-case via the hoisted mocks.
  getImageFolderOverrides: getImageFolderOverridesMock,
  getImageFolderOverridesVersion: getImageFolderOverridesVersionMock,
  // Search requests consult the extras search-text projection so description /
  // alt text / prompt text are reachable across the whole scope.
  getImageExtrasSearchText: getImageExtrasSearchTextMock,
}));

describe('GET /api/images video integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearGalleryQueryScopeMemo();
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
    getImageFolderOverridesMock.mockResolvedValue(new Map<string, string | undefined>());
    getImageFolderOverridesVersionMock.mockReturnValue(0);
    getImageExtrasSearchTextMock.mockResolvedValue(new Map<string, string>());
    batchGetAspectMetadataMock.mockResolvedValue(new Map());
    batchGetColorMetadataMock.mockResolvedValue(new Map());
    isVectorSearchAvailableMock.mockResolvedValue(false);
    hydrateMissingAspectMetadataMock.mockImplementation(async (images: unknown[]) => ({
      images,
      candidateCount: 0,
      resolvedCount: images.length,
      unresolvedCount: 0,
    }));
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

  it('returns unpaginated assets newest first even when cache order is stale', async () => {
    getCachedImagesMock.mockResolvedValue([
      {
        id: 'img-oldest',
        filename: 'oldest.jpg',
        uploaded: '2026-02-18T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/img-oldest/public'],
        tags: [],
      },
      {
        id: 'img-newest',
        filename: 'newest.jpg',
        uploaded: '2026-02-20T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/img-newest/public'],
        tags: [],
      },
      {
        id: 'img-middle',
        filename: 'middle.jpg',
        uploaded: '2026-02-19T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/img-middle/public'],
        tags: [],
      },
    ]);
    listVideoAssetRecordsWithSyncMock.mockResolvedValue([]);

    const response = await GET(new NextRequest('http://localhost/api/images'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.pagination).toBeNull();
    expect(payload.images.map((image: { id: string }) => image.id)).toEqual([
      'img-newest',
      'img-middle',
      'img-oldest',
    ]);
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

  it('searches extras description and prompt text across the scope and echoes the match text', async () => {
    getCachedImagesMock.mockResolvedValue([
      {
        id: 'img-described',
        filename: 'DSC_0041.jpg',
        uploaded: '2026-02-20T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/img-described/public'],
        tags: [],
      },
      {
        id: 'img-prompted',
        filename: 'DSC_0042.jpg',
        uploaded: '2026-02-19T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/img-prompted/public'],
        tags: [],
      },
      {
        id: 'img-unrelated',
        filename: 'DSC_0043.jpg',
        uploaded: '2026-02-18T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/img-unrelated/public'],
        tags: [],
      },
    ]);
    listVideoAssetRecordsWithSyncMock.mockResolvedValue([]);
    getImageExtrasSearchTextMock.mockResolvedValue(new Map([
      ['img-described', 'a red lighthouse at dawn'],
      ['img-prompted', 'wide shot of a lighthouse, storm clouds, 35mm'],
    ]));

    const response = await GET(
      new NextRequest('http://localhost/api/images?page=1&pageSize=60&search=lighthouse')
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.images.map((image: { id: string }) => image.id)).toEqual([
      'img-described',
      'img-prompted',
    ]);
    // The client re-filters the page with the same term, so the matched text
    // has to travel with the asset.
    expect(payload.images[0].searchText).toBe('a red lighthouse at dawn');
  });

  it('hydrates Redis aspect metadata before server-side aspect filtering', async () => {
    getCachedImagesMock.mockResolvedValue([
      {
        id: 'wide-from-redis',
        filename: 'wide.jpg',
        uploaded: '2026-02-20T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/wide-from-redis/public'],
        tags: [],
      },
      {
        id: 'tall-from-redis',
        filename: 'tall.jpg',
        uploaded: '2026-02-19T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/tall-from-redis/public'],
        tags: [],
      },
    ]);
    listVideoAssetRecordsWithSyncMock.mockResolvedValue([]);
    isVectorSearchAvailableMock.mockResolvedValueOnce(true);
    batchGetAspectMetadataMock.mockResolvedValueOnce(
      new Map([
        [
          'wide-from-redis',
          {
            imageId: 'wide-from-redis',
            aspectRatio: '16:9',
            aspectRatioClass: 'horizontal',
            width: 1600,
            height: 900,
          },
        ],
        [
          'tall-from-redis',
          {
            imageId: 'tall-from-redis',
            aspectRatio: '9:16',
            aspectRatioClass: 'vertical',
            width: 900,
            height: 1600,
          },
        ],
      ])
    );

    const response = await GET(
      new NextRequest('http://localhost/api/images?namespace=__all__&page=1&pageSize=60&aspectRatioClasses=horizontal')
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(batchGetAspectMetadataMock).toHaveBeenCalledWith(['wide-from-redis', 'tall-from-redis']);
    expect(batchGetColorMetadataMock).not.toHaveBeenCalled();
    expect(payload.images.map((image: { id: string }) => image.id)).toEqual(['wide-from-redis']);
    expect(payload.images[0]).toEqual(
      expect.objectContaining({
        aspectRatio: '16:9',
        aspectRatioClass: 'horizontal',
        dimensions: { width: 1600, height: 900 },
      })
    );
    expect(payload.pagination).toEqual(
      expect.objectContaining({
        total: 1,
        scopeTotal: 2,
        totalPages: 1,
      })
    );
  });

  it('hydrates missing aspect metadata before counting a filtered corpus', async () => {
    getCachedImagesMock.mockResolvedValue([
      {
        id: 'square-from-hydration',
        filename: 'square.jpg',
        uploaded: '2026-02-20T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/square-from-hydration/public'],
        tags: [],
      },
      {
        id: 'wide-from-hydration',
        filename: 'wide.jpg',
        uploaded: '2026-02-19T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/wide-from-hydration/public'],
        tags: [],
      },
    ]);
    listVideoAssetRecordsWithSyncMock.mockResolvedValue([]);
    isVectorSearchAvailableMock.mockResolvedValueOnce(true);
    batchGetAspectMetadataMock.mockResolvedValueOnce(new Map());
    hydrateMissingAspectMetadataMock.mockImplementationOnce(async (images: Array<{ id: string }>) => ({
      images: images.map((image) => ({
        ...image,
        aspectRatio: image.id === 'square-from-hydration' ? '1:1' : '16:9',
        dimensions: image.id === 'square-from-hydration'
          ? { width: 1000, height: 1000 }
          : { width: 1600, height: 900 },
      })),
      candidateCount: images.length,
      resolvedCount: images.length,
      unresolvedCount: 0,
    }));

    const response = await GET(
      new NextRequest('http://localhost/api/images?namespace=__all__&page=1&pageSize=60&aspectRatioClasses=square')
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(hydrateMissingAspectMetadataMock).toHaveBeenCalledTimes(1);
    expect(payload.images.map((image: { id: string }) => image.id)).toEqual(['square-from-hydration']);
    expect(payload.pagination).toEqual(
      expect.objectContaining({
        total: 1,
        scopeTotal: 2,
        totalPages: 1,
      })
    );
  });

  it('uses extras-backed folders for gallery facets, filters, hidden folders, and cards', async () => {
    getCachedImagesMock.mockResolvedValue([
      {
        id: 'moved-image',
        filename: 'moved.jpg',
        folder: 'old-folder',
        uploaded: '2026-02-20T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/moved-image/public'],
        tags: [],
      },
      {
        id: 'other-image',
        filename: 'other.jpg',
        folder: 'other-folder',
        uploaded: '2026-02-19T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/other-image/public'],
        tags: [],
      },
    ]);
    listVideoAssetRecordsWithSyncMock.mockResolvedValue([]);
    getImageExtrasRecordsMock.mockResolvedValue({
      'moved-image': {
        schemaVersion: 1,
        imageId: 'moved-image',
        folder: 'new-folder',
        createdAt: '2026-02-20T00:00:00.000Z',
        updatedAt: '2026-02-20T00:00:00.000Z',
      },
      'other-image': null,
    });
    // Fix 1 (perf): the route now consults the in-memory folder-override map
    // for pre-pagination folder merging. Seed it to match the extras above.
    getImageFolderOverridesMock.mockResolvedValue(
      new Map<string, string | undefined>([['moved-image', 'new-folder']])
    );

    const facetResponse = await GET(
      new NextRequest('http://localhost/api/images?page=1&pageSize=10')
    );
    const facetPayload = await facetResponse.json();

    expect(facetResponse.status).toBe(200);
    expect(facetPayload.images.find((image: { id: string }) => image.id === 'moved-image')).toEqual(
      expect.objectContaining({ folder: 'new-folder' })
    );
    expect(facetPayload.facets.folders).toEqual([
      { value: 'new-folder', count: 1 },
      { value: 'other-folder', count: 1 },
    ]);

    const folderResponse = await GET(
      new NextRequest('http://localhost/api/images?page=1&pageSize=10&folder=new-folder')
    );
    const folderPayload = await folderResponse.json();

    expect(folderResponse.status).toBe(200);
    expect(folderPayload.images.map((image: { id: string }) => image.id)).toEqual(['moved-image']);

    const hiddenResponse = await GET(
      new NextRequest('http://localhost/api/images?page=1&pageSize=10&hiddenFolders=new-folder')
    );
    const hiddenPayload = await hiddenResponse.json();

    expect(hiddenResponse.status).toBe(200);
    expect(hiddenPayload.images.map((image: { id: string }) => image.id)).toEqual(['other-image']);
    expect(hiddenPayload.facets.folders).toEqual([{ value: 'other-folder', count: 1 }]);
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


