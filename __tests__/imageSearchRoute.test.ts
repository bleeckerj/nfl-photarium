import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const {
  getCachedImagesMock,
} = vi.hoisted(() => ({
  getCachedImagesMock: vi.fn(),
}));

const {
  listVideoAssetRecordsWithSyncMock,
} = vi.hoisted(() => ({
  listVideoAssetRecordsWithSyncMock: vi.fn(),
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

const {
  getImageExtrasRecordsMock,
  listImageExtrasImageIdsMock,
} = vi.hoisted(() => ({
  getImageExtrasRecordsMock: vi.fn(),
  listImageExtrasImageIdsMock: vi.fn(),
}));

vi.mock('@/server/cloudflareImageCache', () => ({
  getCachedImages: getCachedImagesMock,
}));

vi.mock('@/server/videoCatalogStorage', () => ({
  listVideoAssetRecordsWithSync: listVideoAssetRecordsWithSyncMock,
}));

vi.mock('@/server/vectorSearch', () => ({
  searchByText: searchByTextMock,
  searchByHexColor: searchByHexColorMock,
  searchByCLIP: searchByCLIPMock,
  getImageVectors: getImageVectorsMock,
  isVectorSearchAvailable: isVectorSearchAvailableMock,
}));

vi.mock('@/server/imageExtras', () => ({
  getImageExtrasRecords: getImageExtrasRecordsMock,
  listImageExtrasImageIds: listImageExtrasImageIdsMock,
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
    listVideoAssetRecordsWithSyncMock.mockResolvedValue([]);
    listImageExtrasImageIdsMock.mockResolvedValue([]);
    getImageExtrasRecordsMock.mockResolvedValue({});
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

  it('finds assets by Discord message id from sourceUrl metadata', async () => {
    getCachedImagesMock.mockResolvedValue([
      {
        id: 'discord_asset_1',
        filename: 'image-2026-02-27T16-27-37.png',
        displayName: 'RetroKioskInteraction',
        tags: ['discord', 'midjourney'],
      },
    ]);
    searchByTextMock.mockResolvedValue([]);
    listImageExtrasImageIdsMock.mockResolvedValue(['discord_asset_1']);
    getImageExtrasRecordsMock.mockResolvedValue({
      discord_asset_1: {
        schemaVersion: 1,
        imageId: 'discord_asset_1',
        createdAt: '2026-03-09T00:10:56.735Z',
        updatedAt: '2026-03-09T00:10:58.354Z',
        sourceUrl: 'https://discord.com/channels/724979694667169862/1188501030695092225/1476850850478690358',
        sourceUrlNormalized: 'https://discord.com/channels/724979694667169862/1188501030695092225/1476850850478690358',
      },
    });

    const response = await POST(
      createJsonRequest('http://localhost/api/images/search', { type: 'text', query: '1476850850478690358' })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.count).toBe(1);
    expect(payload.results[0].imageId).toBe('discord_asset_1');
    expect(payload.results[0].canonicalImageId).toBe('discord_asset_1');
  });

  it('returns exact Discord source matches even when the active namespace differs', async () => {
    getCachedImagesMock.mockResolvedValue([
      {
        id: 'discord_asset_1',
        filename: 'image-2026-02-27T16-27-37.png',
        displayName: 'RetroKioskInteraction',
        namespace: 'cf-midjourney',
        tags: ['discord', 'midjourney'],
      },
      {
        id: 'default_asset_1',
        filename: 'other.png',
        displayName: 'Other Image',
        namespace: 'cf-default',
        tags: ['discord'],
      },
    ]);
    searchByTextMock.mockResolvedValue([
      { imageId: 'default_asset_1', filename: 'other.png', score: 0.2 },
    ]);
    listImageExtrasImageIdsMock.mockResolvedValue(['discord_asset_1']);
    getImageExtrasRecordsMock.mockResolvedValue({
      discord_asset_1: {
        schemaVersion: 1,
        imageId: 'discord_asset_1',
        createdAt: '2026-03-09T00:10:56.735Z',
        updatedAt: '2026-03-09T00:10:58.354Z',
        sourceUrl: 'https://discord.com/channels/724979694667169862/1188501030695092225/1476850850478690358',
        sourceUrlNormalized: 'https://discord.com/channels/724979694667169862/1188501030695092225/1476850850478690358',
      },
    });

    const response = await POST(
      createJsonRequest('http://localhost/api/images/search', {
        type: 'text',
        query: '1476850850478690358',
        namespace: 'cf-default',
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.results[0].imageId).toBe('discord_asset_1');
  });

  it('assigns a numeric score to lexical-only reranked text results', async () => {
    getCachedImagesMock.mockResolvedValue([
      {
        id: 'brutalist_1',
        filename: 'frame-01.jpg',
        displayName: 'Brutalist Concrete Study',
        tags: ['architecture'],
      },
    ]);
    searchByTextMock.mockResolvedValue([]);

    const response = await POST(
      createJsonRequest('http://localhost/api/images/search', { type: 'text', query: 'brutalist' })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.count).toBe(1);
    expect(payload.results[0].imageId).toBe('brutalist_1');
    expect(typeof payload.results[0].score).toBe('number');
    expect(Number.isFinite(payload.results[0].score)).toBe(true);
  });
});
