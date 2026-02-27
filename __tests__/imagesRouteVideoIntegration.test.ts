import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/images/route';

const {
  getCachedImagesMock,
  getCacheStatsMock,
  listVideoAssetRecordsWithSyncMock,
} = vi.hoisted(() => ({
  getCachedImagesMock: vi.fn(),
  getCacheStatsMock: vi.fn(),
  listVideoAssetRecordsWithSyncMock: vi.fn(),
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
});
