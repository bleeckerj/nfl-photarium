import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const {
  getCachedImagesMock,
} = vi.hoisted(() => ({
  getCachedImagesMock: vi.fn(),
}));

const {
  searchByTextMock,
  searchByHexColorMock,
  searchByCLIPMock,
  getImageVectorsMock,
  isVectorSearchAvailableMock,
} = vi.hoisted(() => ({
  searchByTextMock: vi.fn(),
  searchByHexColorMock: vi.fn(),
  searchByCLIPMock: vi.fn(),
  getImageVectorsMock: vi.fn(),
  isVectorSearchAvailableMock: vi.fn(),
}));

vi.mock('@/server/cloudflareImageCache', () => ({
  getCachedImages: getCachedImagesMock,
}));

vi.mock('@/server/vectorSearch', () => ({
  searchByText: searchByTextMock,
  searchByHexColor: searchByHexColorMock,
  searchByCLIP: searchByCLIPMock,
  getImageVectors: getImageVectorsMock,
  isVectorSearchAvailable: isVectorSearchAvailableMock,
}));

import { POST } from '@/app/api/images/search/route';

function createJsonRequest(url: string, body: unknown) {
  return new NextRequest(
    new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

describe('POST /api/images/search canonical IDs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isVectorSearchAvailableMock.mockResolvedValue(true);
    searchByHexColorMock.mockResolvedValue([]);
    searchByCLIPMock.mockResolvedValue([]);
    getImageVectorsMock.mockResolvedValue(null);
  });

  it('returns canonical id aliases when search already returns imageId', async () => {
    getCachedImagesMock.mockResolvedValue([
      { id: 'img_1', filename: 'alpha.jpg', displayName: 'Alpha Hero' },
    ]);
    searchByTextMock.mockResolvedValue([
      { imageId: 'img_1', filename: 'alpha.jpg', score: 0.91, folder: 'test' },
    ]);

    const response = await POST(
      createJsonRequest('http://localhost/api/images/search', { type: 'text', query: 'alpha' })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.count).toBe(1);
    expect(payload.results[0].imageId).toBe('img_1');
    expect(payload.results[0].id).toBe('img_1');
    expect(payload.results[0].canonicalImageId).toBe('img_1');
    expect(payload.results[0].requestedImageId).toBeUndefined();
  });

  it('resolves display-name style IDs to canonical catalog IDs', async () => {
    getCachedImagesMock.mockResolvedValue([
      { id: 'canon_123', filename: 'look-001.jpg', displayName: 'Editorial Hero Look' },
    ]);
    searchByTextMock.mockResolvedValue([
      { imageId: 'Editorial Hero Look', filename: 'look-001.jpg', score: 0.88, folder: 'test' },
    ]);

    const response = await POST(
      createJsonRequest('http://localhost/api/images/search', { type: 'text', query: 'editorial hero' })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.count).toBe(1);
    expect(payload.results[0].imageId).toBe('canon_123');
    expect(payload.results[0].id).toBe('canon_123');
    expect(payload.results[0].canonicalImageId).toBe('canon_123');
    expect(payload.results[0].requestedImageId).toBe('Editorial Hero Look');
  });
});
