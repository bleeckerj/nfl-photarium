import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  getCachedImageMock,
  transformApiImageToCachedMock,
  upsertCachedImageMock,
  fetchCloudflareImageMock,
  probeAnimatedImageFromOriginalBlobMock,
  isVectorSearchAvailableMock,
  batchGetColorMetadataMock,
  batchGetAspectMetadataMock,
} = vi.hoisted(() => ({
  getCachedImageMock: vi.fn(),
  transformApiImageToCachedMock: vi.fn(),
  upsertCachedImageMock: vi.fn(),
  fetchCloudflareImageMock: vi.fn(),
  probeAnimatedImageFromOriginalBlobMock: vi.fn(),
  isVectorSearchAvailableMock: vi.fn(),
  batchGetColorMetadataMock: vi.fn(),
  batchGetAspectMetadataMock: vi.fn(),
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
  batchGetAspectMetadata: batchGetAspectMetadataMock,
  batchGetColorMetadata: batchGetColorMetadataMock,
  isVectorSearchAvailable: isVectorSearchAvailableMock,
}));

vi.mock('@/server/videoCatalogStorage', () => ({
  deleteVideoAssetRecord: vi.fn(),
  getVideoAssetRecord: vi.fn(),
}));

import { GET } from '@/app/api/images/[id]/route';

describe('GET /api/images/:id embedding status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCachedImageMock.mockResolvedValue({
      id: 'img-1',
      filename: 'photo.jpg',
      uploaded: '2026-03-20T00:00:00.000Z',
      variants: ['https://imagedelivery.net/hash/img-1/public'],
      tags: [],
      hasClipEmbedding: false,
      hasColorEmbedding: false,
    });
    isVectorSearchAvailableMock.mockResolvedValue(true);
    batchGetColorMetadataMock.mockResolvedValue(
      new Map([
        ['img-1', {
          imageId: 'img-1',
          dominantColors: ['#112233', '#445566'],
          averageColor: '#223344',
          hasClipEmbedding: true,
          hasColorEmbedding: true,
        }],
      ])
    );
    batchGetAspectMetadataMock.mockResolvedValue(
      new Map([
        ['img-1', {
          imageId: 'img-1',
          aspectRatio: '4:3',
          width: 1600,
          height: 1200,
        }],
      ])
    );
    probeAnimatedImageFromOriginalBlobMock.mockResolvedValue({
      contentType: 'image/webp',
      format: 'webp',
      isAnimated: false,
    });
  });

  it('enriches cached images with Redis embedding metadata before responding', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/images/img-1'),
      { params: Promise.resolve({ id: 'img-1' }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.image).toEqual(
      expect.objectContaining({
        id: 'img-1',
        hasClipEmbedding: true,
        hasColorEmbedding: true,
        dominantColors: ['#112233', '#445566'],
        averageColor: '#223344',
        aspectRatio: '4:3',
        dimensions: { width: 1600, height: 1200 },
      })
    );
    expect(upsertCachedImageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'img-1',
        hasClipEmbedding: true,
        hasColorEmbedding: true,
      })
    );
  });

  it('self-heals cached webp assets with actual animated state from the original blob', async () => {
    getCachedImageMock.mockResolvedValueOnce({
      id: 'img-anim',
      filename: 'generated.webp',
      uploaded: '2026-03-20T00:00:00.000Z',
      variants: ['https://imagedelivery.net/hash/img-anim/public'],
      tags: [],
      contentType: 'image/webp',
      hasClipEmbedding: false,
      hasColorEmbedding: false,
    });
    batchGetColorMetadataMock.mockResolvedValueOnce(new Map());
    batchGetAspectMetadataMock.mockResolvedValueOnce(new Map());
    probeAnimatedImageFromOriginalBlobMock.mockResolvedValueOnce({
      contentType: 'image/webp',
      format: 'webp',
      isAnimated: true,
    });

    const response = await GET(
      new NextRequest('http://localhost/api/images/img-anim'),
      { params: Promise.resolve({ id: 'img-anim' }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.image.isAnimated).toBe(true);
    expect(upsertCachedImageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'img-anim',
        isAnimated: true,
        contentType: 'image/webp',
      })
    );
  });
});
