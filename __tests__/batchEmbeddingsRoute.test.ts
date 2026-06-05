import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  ensureVectorIndexMock,
  extractColorsFromUrlMock,
  generateClipEmbeddingMock,
  getCachedImageMock,
  getImageVectorsMock,
  isVectorSearchAvailableMock,
  storeImageVectorsMock,
  upsertCachedImageMock,
} = vi.hoisted(() => ({
  ensureVectorIndexMock: vi.fn(),
  extractColorsFromUrlMock: vi.fn(),
  generateClipEmbeddingMock: vi.fn(),
  getCachedImageMock: vi.fn(),
  getImageVectorsMock: vi.fn(),
  isVectorSearchAvailableMock: vi.fn(),
  storeImageVectorsMock: vi.fn(),
  upsertCachedImageMock: vi.fn(),
}));

vi.mock('@/server/cloudflareImageCache', () => ({
  getCachedImage: getCachedImageMock,
  upsertCachedImage: upsertCachedImageMock,
}));

vi.mock('@/server/embeddingService', () => ({
  generateClipEmbedding: generateClipEmbeddingMock,
}));

vi.mock('@/server/colorExtraction', () => ({
  extractColorsFromUrl: extractColorsFromUrlMock,
}));

vi.mock('@/server/vectorSearch', () => ({
  ensureVectorIndex: ensureVectorIndexMock,
  getImageVectors: getImageVectorsMock,
  isVectorSearchAvailable: isVectorSearchAvailableMock,
  storeImageVectors: storeImageVectorsMock,
}));

import { POST } from '@/app/api/images/embeddings/batch/route';

describe('POST /api/images/embeddings/batch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isVectorSearchAvailableMock.mockResolvedValue(true);
    ensureVectorIndexMock.mockResolvedValue(undefined);
    getCachedImageMock.mockResolvedValue({
      id: 'img-1',
      filename: 'photo.jpg',
      uploaded: '2026-06-04T00:00:00.000Z',
      variants: ['https://imagedelivery.net/account/img-1/w=300'],
      tags: [],
      hasClipEmbedding: false,
      hasColorEmbedding: false,
    });
  });

  it('self-heals stale cache flags when Redis vectors already exist', async () => {
    getImageVectorsMock.mockResolvedValue({
      imageId: 'img-1',
      clipEmbedding: [0.1],
      colorHistogram: [0.2],
      dominantColors: ['#112233', '#445566'],
      averageColor: '#223344',
    });

    const request = new NextRequest('http://localhost/api/images/embeddings/batch', {
      method: 'POST',
      body: JSON.stringify({ imageIds: ['img-1'] }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      total: 1,
      success: 1,
      skipped: 0,
      errors: 0,
      results: [
        {
          imageId: 'img-1',
          success: true,
          clipGenerated: false,
          colorGenerated: false,
          hasClipEmbedding: true,
          hasColorEmbedding: true,
          dominantColors: ['#112233', '#445566'],
          averageColor: '#223344',
        },
      ],
    });
    expect(upsertCachedImageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'img-1',
        hasClipEmbedding: true,
        hasColorEmbedding: true,
        dominantColors: ['#112233', '#445566'],
        averageColor: '#223344',
      })
    );
    expect(generateClipEmbeddingMock).not.toHaveBeenCalled();
    expect(extractColorsFromUrlMock).not.toHaveBeenCalled();
    expect(storeImageVectorsMock).not.toHaveBeenCalled();
  });
});
