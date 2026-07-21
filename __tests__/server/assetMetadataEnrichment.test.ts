import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CachedCloudflareImage } from '@/server/cloudflareImageCache';
import type { VideoAssetRecord } from '@/server/videoCatalogStorage';

const getCachedImageMock = vi.fn();
const upsertCachedImageMock = vi.fn();
const syncVideoAssetRecordFromStreamMock = vi.fn();
const updateVideoAssetRecordMock = vi.fn();
const probeVideoSourceMock = vi.fn();
const fetchImageDimensionsMock = vi.fn();
const storeImageAspectMetadataMock = vi.fn();

vi.mock('@/server/cloudflareImageCache', () => ({
  getCachedImage: getCachedImageMock,
  getCachedImages: vi.fn(),
  upsertCachedImage: upsertCachedImageMock,
}));

vi.mock('@/server/videoCatalogStorage', () => ({
  getVideoAssetRecord: vi.fn(),
  listVideoAssetRecordsWithSync: vi.fn(),
  syncVideoAssetRecordFromStream: syncVideoAssetRecordFromStreamMock,
  updateVideoAssetRecord: updateVideoAssetRecordMock,
}));

vi.mock('@/server/videoDownloadUrl', () => ({
  resolveVideoDownloadUrls: (video: VideoAssetRecord) =>
    [video.originalUrl, video.sourceUrl].filter((value): value is string => Boolean(value)),
}));

vi.mock('@/server/videoFrameService', () => ({
  probeVideoSource: probeVideoSourceMock,
}));

vi.mock('@/server/aspectRatio', () => ({
  classifyAspectRatio: (width: number, height: number) => {
    const ratio = width / height;
    if (Math.abs(ratio - 1) <= 0.05) return 'square';
    return ratio > 1 ? 'horizontal' : 'vertical';
  },
  fetchImageDimensions: fetchImageDimensionsMock,
}));

vi.mock('@/server/vectorSearch', () => ({
  storeImageAspectMetadata: storeImageAspectMetadataMock,
}));

vi.mock('@/utils/imageUtils', async () => {
  const actual = await vi.importActual<typeof import('@/utils/imageUtils')>('@/utils/imageUtils');
  return {
    ...actual,
    getCloudflareImageUrl: (id: string) => `https://cdn.example.com/${id}/public`,
  };
});

describe('asset metadata enrichment', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('enriches image metadata and persists the repaired record', async () => {
    const image: CachedCloudflareImage = {
      id: 'img-1',
      filename: 'img.jpg',
      uploaded: '2026-04-27T00:00:00.000Z',
      variants: ['https://cdn.example.com/img-1/public'],
      tags: [],
    };
    getCachedImageMock.mockResolvedValue(image);
    fetchImageDimensionsMock.mockResolvedValue({ width: 1800, height: 1200 });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-length': '2048' }),
      })
    );

    const { enrichImageAssetMetadata } = await import('@/server/assetMetadataEnrichment');
    const enriched = await enrichImageAssetMetadata('img-1');

    expect(enriched).toMatchObject({
      size: 2048,
      aspectRatio: '3:2',
      dimensions: { width: 1800, height: 1200 },
    });
    expect(upsertCachedImageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'img-1',
        size: 2048,
        aspectRatio: '3:2',
        dimensions: { width: 1800, height: 1200 },
      })
    );
    expect(storeImageAspectMetadataMock).toHaveBeenCalledWith({
      imageId: 'img-1',
      aspectRatio: '3:2',
      aspectRatioClass: 'horizontal',
      width: 1800,
      height: 1200,
    });
  });

  it('persists existing complete image dimensions to Redis without recomputing them', async () => {
    const image: CachedCloudflareImage = {
      id: 'img-existing',
      filename: 'existing.jpg',
      uploaded: '2026-04-27T00:00:00.000Z',
      variants: ['https://cdn.example.com/img-existing/public'],
      tags: [],
      size: 4096,
      aspectRatio: '1:1',
      dimensions: { width: 1200, height: 1200 },
    };
    getCachedImageMock.mockResolvedValue(image);

    const { enrichImageAssetMetadata } = await import('@/server/assetMetadataEnrichment');
    const enriched = await enrichImageAssetMetadata('img-existing');

    expect(enriched).toBe(image);
    expect(fetchImageDimensionsMock).not.toHaveBeenCalled();
    expect(upsertCachedImageMock).not.toHaveBeenCalled();
    expect(storeImageAspectMetadataMock).toHaveBeenCalledWith({
      imageId: 'img-existing',
      aspectRatio: '1:1',
      aspectRatioClass: 'square',
      width: 1200,
      height: 1200,
    });
  });

  it('supports aspect-only enrichment without probing file size', async () => {
    const image: CachedCloudflareImage = {
      id: 'img-aspect-only',
      filename: 'aspect-only.jpg',
      uploaded: '2026-04-27T00:00:00.000Z',
      variants: ['https://cdn.example.com/img-aspect-only/public'],
      tags: [],
    };
    getCachedImageMock.mockResolvedValue(image);
    fetchImageDimensionsMock.mockResolvedValue({ width: 1200, height: 1200 });
    vi.stubGlobal('fetch', vi.fn());

    const { enrichImageAssetMetadata } = await import('@/server/assetMetadataEnrichment');
    const enriched = await enrichImageAssetMetadata('img-aspect-only', { includeSize: false });

    expect(enriched).toMatchObject({
      aspectRatio: '1:1',
      dimensions: { width: 1200, height: 1200 },
    });
    expect(enriched?.size).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
    expect(storeImageAspectMetadataMock).toHaveBeenCalledWith({
      imageId: 'img-aspect-only',
      aspectRatio: '1:1',
      aspectRatioClass: 'square',
      width: 1200,
      height: 1200,
    });
  });

  it('enriches video metadata from stream sync, HEAD size, and ffprobe fallback', async () => {
    const syncedVideo: VideoAssetRecord = {
      id: 'vid-1',
      assetType: 'video',
      filename: 'clip.mp4',
      uploaded: '2026-04-27T00:00:00.000Z',
      tags: [],
      streamUid: 'stream-1',
      videoStatus: 'ready',
      createdAt: '2026-04-27T00:00:00.000Z',
      updatedAt: '2026-04-27T00:00:00.000Z',
      originalUrl: 'https://files.example.com/clip.mp4',
    };
    syncVideoAssetRecordFromStreamMock.mockResolvedValue(syncedVideo);
    probeVideoSourceMock.mockResolvedValue({
      durationSeconds: 9,
      fps: 24,
      frameCount: 216,
      exactFrameCount: true,
      width: 1920,
      height: 1080,
    });
    updateVideoAssetRecordMock.mockImplementation(async (_id: string, patch: Partial<VideoAssetRecord>) => ({
      ...syncedVideo,
      ...patch,
    }));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-length': '4096' }),
      })
    );

    const { enrichVideoAssetMetadata } = await import('@/server/assetMetadataEnrichment');
    const enriched = await enrichVideoAssetMetadata(syncedVideo);

    expect(updateVideoAssetRecordMock).toHaveBeenCalledWith(
      'vid-1',
      expect.objectContaining({
        fileSizeBytes: 4096,
        durationSeconds: 9,
        width: 1920,
        height: 1080,
        aspectRatio: '16:9',
      })
    );
    expect(enriched).toMatchObject({
      fileSizeBytes: 4096,
      durationSeconds: 9,
      width: 1920,
      height: 1080,
      aspectRatio: '16:9',
    });
  });
});
