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

  it('answers 304 for an unchanged If-None-Match tag and 200 after a version bump', async () => {
    const url = 'http://localhost/api/images?page=1&pageSize=30';
    const first = await GET(new NextRequest(url));
    const etag = first.headers.get('ETag');
    expect(first.status).toBe(200);
    expect(etag).toBeTruthy();
    expect(first.headers.get('Cache-Control')).toContain('no-cache');

    const second = await GET(new NextRequest(url, {
      headers: { 'if-none-match': etag as string },
    }));
    expect(second.status).toBe(304);
    expect(second.headers.get('ETag')).toBe(etag);

    getCacheStatsMock.mockReturnValue({ lastFetched: Date.now(), contentVersion: 42 });
    const third = await GET(new NextRequest(url, {
      headers: { 'if-none-match': etag as string },
    }));
    expect(third.status).toBe(200);
  });

  it('never issues an ETag for requests that consume unversioned metadata', async () => {
    const response = await GET(new NextRequest('http://localhost/api/images?includeVectorMeta=1'));
    expect(response.status).toBe(200);
    expect(response.headers.get('ETag')).toBeNull();
  });

  it('marks existing animated WebP derivatives as Comfy when their source video is Comfy', async () => {
    getCachedImagesMock.mockResolvedValueOnce([
      {
        id: 'webp-1',
        filename: 'clip.webp',
        uploaded: '2026-02-20T02:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/webp-1/public'],
        tags: ['animated-webp'],
      },
    ]);
    listVideoAssetRecordsWithSyncMock.mockResolvedValueOnce([
      {
        id: 'vid-comfy',
        assetType: 'video',
        generatedBy: 'comfyui',
        comfyMetadataDetected: true,
        comfyMetadataSource: 'video:prompt',
        filename: 'clip.mp4',
        uploaded: '2026-02-20T01:00:00.000Z',
        streamUid: 'stream-uid',
        hlsUrl: 'https://videodelivery.net/stream-uid/manifest/video.m3u8',
        videoStatus: 'ready',
        tags: [],
        animatedWebpImageId: 'webp-1',
        animatedWebpVariants: [],
        createdAt: '2026-02-20T01:00:00.000Z',
        updatedAt: '2026-02-20T01:00:00.000Z',
      },
    ]);

    const response = await GET(new NextRequest('http://localhost/api/images?mediaFilter=animated'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.images).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'webp-1',
          generatedBy: 'comfyui',
          comfyMetadataDetected: true,
          comfyMetadataSource: 'video:prompt',
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
});
