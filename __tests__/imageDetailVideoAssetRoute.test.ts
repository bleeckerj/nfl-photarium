import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  getCachedImageMock,
  transformApiImageToCachedMock,
  upsertCachedImageMock,
  fetchCloudflareImageMock,
  probeAnimatedImageFromOriginalBlobMock,
  isVectorSearchAvailableMock,
  getImageExtrasRecordMock,
  getVideoAssetRecordMock,
  listVideoAssetRecordsMock,
} = vi.hoisted(() => ({
  getCachedImageMock: vi.fn(),
  transformApiImageToCachedMock: vi.fn(),
  upsertCachedImageMock: vi.fn(),
  fetchCloudflareImageMock: vi.fn(),
  probeAnimatedImageFromOriginalBlobMock: vi.fn(),
  isVectorSearchAvailableMock: vi.fn(),
  getImageExtrasRecordMock: vi.fn(),
  getVideoAssetRecordMock: vi.fn(),
  listVideoAssetRecordsMock: vi.fn(),
}));

vi.mock('@/server/cloudflareImageCache', () => ({
  getCachedImage: getCachedImageMock,
  transformApiImageToCached: transformApiImageToCachedMock,
  upsertCachedImage: upsertCachedImageMock,
}));

vi.mock('@/server/cloudflareClient', () => ({
  fetchCloudflareImage: fetchCloudflareImageMock,
  getCloudflareCredentials: vi.fn(() => ({
    accountId: 'account',
    apiToken: 'token',
  })),
}));

vi.mock('@/server/animatedImageProbe', () => ({
  probeAnimatedImageFromOriginalBlob: probeAnimatedImageFromOriginalBlobMock,
}));

vi.mock('@/server/imageArtifactCleanup', () => ({
  cleanupImageArtifacts: vi.fn(),
}));

vi.mock('@/server/cloudflareStreamClient', () => ({
  deleteStreamVideo: vi.fn(),
}));

vi.mock('@/server/vectorSearch', () => ({
  batchGetAspectMetadata: vi.fn(async () => new Map()),
  batchGetColorMetadata: vi.fn(async () => new Map()),
  isVectorSearchAvailable: isVectorSearchAvailableMock,
}));

vi.mock('@/server/videoCatalogStorage', () => ({
  deleteVideoAssetRecord: vi.fn(),
  getVideoAssetRecord: getVideoAssetRecordMock,
  listVideoAssetRecords: listVideoAssetRecordsMock,
}));

vi.mock('@/server/imageExtras', () => ({
  getImageExtrasRecord: getImageExtrasRecordMock,
}));

import { GET } from '@/app/api/images/[id]/route';

const videoRecord = {
  id: 'f7ee47e7-f2fa-40a3-8f73-265e3fa55cca',
  assetType: 'video' as const,
  filename: 'clip.mp4',
  displayName: 'Clip',
  fileSizeBytes: 123456,
  uploaded: '2026-07-29T01:58:02.212Z',
  streamUid: 'stream-uid-1',
  playbackUrl: 'https://stream.example/stream-uid-1/iframe',
  hlsUrl: 'https://stream.example/stream-uid-1/manifest/video.m3u8',
  thumbnailUrl: 'https://stream.example/stream-uid-1/thumbnails/thumbnail.jpg',
  previewUrl: 'https://stream.example/stream-uid-1/watch',
  videoStatus: 'ready' as const,
  durationSeconds: 4.2,
  tags: ['work kit'],
  namespace: 'cf-default',
};

describe('GET /api/images/:id for video-catalog assets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCachedImageMock.mockResolvedValue(undefined);
    getVideoAssetRecordMock.mockResolvedValue(null);
    fetchCloudflareImageMock.mockRejectedValue(
      new Error('Cloudflare Images has no record with this id')
    );
    isVectorSearchAvailableMock.mockResolvedValue(false);
    getImageExtrasRecordMock.mockResolvedValue(null);
    listVideoAssetRecordsMock.mockResolvedValue([]);
  });

  it('serves catalog data for video assets instead of asking Cloudflare Images', async () => {
    getVideoAssetRecordMock.mockResolvedValueOnce(videoRecord);

    const response = await GET(
      new NextRequest(`http://localhost/api/images/${videoRecord.id}?includeVectorMeta=1`),
      { params: Promise.resolve({ id: videoRecord.id }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.image).toEqual(
      expect.objectContaining({
        id: videoRecord.id,
        assetType: 'video',
        filename: 'clip.mp4',
        videoStatus: 'ready',
        videoPlaybackUrl: videoRecord.playbackUrl,
        videoHlsUrl: videoRecord.hlsUrl,
        videoThumbnailUrl: videoRecord.thumbnailUrl,
        namespace: 'cf-default',
        fileSizeBytes: 123456,
      })
    );
    expect(payload.diagnostics.source).toBe('video-catalog');
    expect(fetchCloudflareImageMock).not.toHaveBeenCalled();
    // Video records must never be written into the image catalog.
    expect(upsertCachedImageMock).not.toHaveBeenCalled();
  });

  it('serves video catalog data on refresh=1 without a Cloudflare Images fetch', async () => {
    getVideoAssetRecordMock.mockResolvedValueOnce(videoRecord);

    const response = await GET(
      new NextRequest(`http://localhost/api/images/${videoRecord.id}?refresh=1`),
      { params: Promise.resolve({ id: videoRecord.id }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.image.assetType).toBe('video');
    expect(fetchCloudflareImageMock).not.toHaveBeenCalled();
  });

  it('still returns 500 when the id is in neither catalog', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/images/00000000-0000-4000-8000-000000000000'),
      { params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000000' }) }
    );

    expect(response.status).toBe(500);
    expect(getVideoAssetRecordMock).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000000'
    );
  });
});
