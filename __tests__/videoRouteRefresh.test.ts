import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/videos/[id]/route';

const {
  getVideoAssetRecordMock,
  syncVideoAssetRecordFromStreamMock,
} = vi.hoisted(() => ({
  getVideoAssetRecordMock: vi.fn(),
  syncVideoAssetRecordFromStreamMock: vi.fn(),
}));

vi.mock('@/server/videoCatalogStorage', () => ({
  getVideoAssetRecord: getVideoAssetRecordMock,
  syncVideoAssetRecordFromStream: syncVideoAssetRecordFromStreamMock,
}));

const ORIGINAL_ENV = { ...process.env };

const createParams = (id: string) => ({ params: Promise.resolve({ id }) });

describe('GET /api/videos/[id] refresh behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };

    getVideoAssetRecordMock.mockResolvedValue({
      id: 'vid-1',
      assetType: 'video',
      filename: 'clip.mp4',
      uploaded: '2026-03-01T00:00:00.000Z',
      streamUid: 'stream-1',
      videoStatus: 'pending',
      tags: [],
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
    });

    syncVideoAssetRecordFromStreamMock.mockImplementation(async (record) => ({
      ...record,
      videoStatus: 'ready',
    }));
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('does not sync when refresh is not requested', async () => {
    const req = new NextRequest('http://localhost/api/videos/vid-1');
    const res = await GET(req, createParams('vid-1'));
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.video.id).toBe('vid-1');
    expect(syncVideoAssetRecordFromStreamMock).not.toHaveBeenCalled();
  });

  it('forces stream sync when refresh=1', async () => {
    const req = new NextRequest('http://localhost/api/videos/vid-1?refresh=1');
    const res = await GET(req, createParams('vid-1'));
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(syncVideoAssetRecordFromStreamMock).toHaveBeenCalledTimes(1);
    expect(payload.video.videoStatus).toBe('ready');
  });

  it('returns 404 when record missing', async () => {
    getVideoAssetRecordMock.mockResolvedValueOnce(null);
    const req = new NextRequest('http://localhost/api/videos/missing?refresh=1');
    const res = await GET(req, createParams('missing'));
    const payload = await res.json();

    expect(res.status).toBe(404);
    expect(payload.error).toMatch(/not found/i);
  });
});
