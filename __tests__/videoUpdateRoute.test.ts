import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  getVideoAssetRecordMock,
  updateVideoAssetRecordMock,
  upsertRegistryNamespaceMock,
} = vi.hoisted(() => ({
  getVideoAssetRecordMock: vi.fn(),
  updateVideoAssetRecordMock: vi.fn(),
  upsertRegistryNamespaceMock: vi.fn(),
}));

vi.mock('@/server/videoCatalogStorage', () => ({
  getVideoAssetRecord: getVideoAssetRecordMock,
  updateVideoAssetRecord: updateVideoAssetRecordMock,
}));

vi.mock('@/server/namespaceRegistry', () => ({
  upsertRegistryNamespace: upsertRegistryNamespaceMock,
}));

import { PATCH } from '@/app/api/videos/[id]/update/route';

const createParams = (id: string) => ({ params: Promise.resolve({ id }) });

describe('PATCH /api/videos/[id]/update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getVideoAssetRecordMock.mockResolvedValue({
      id: 'vid-1',
      assetType: 'video',
      filename: 'clip.mp4',
      uploaded: '2026-03-01T00:00:00.000Z',
      streamUid: 'stream-1',
      videoStatus: 'ready',
      tags: ['old'],
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
    });
    updateVideoAssetRecordMock.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
      id: 'vid-1',
      assetType: 'video',
      filename: 'clip.mp4',
      uploaded: '2026-03-01T00:00:00.000Z',
      streamUid: 'stream-1',
      videoStatus: 'ready',
      tags: [],
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-02T00:00:00.000Z',
      ...patch,
    }));
  });

  it('normalizes and persists mutable metadata fields', async () => {
    const request = new NextRequest('http://localhost/api/videos/vid-1/update', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folder: '  folder-a  ',
        tags: ' hero, promo, hero ',
        description: '  sample desc  ',
        displayName: '  My Clip  ',
        originalUrl: ' https://example.com/a ',
        sourceUrl: ' https://example.com/page ',
        namespace: '  cf-default ',
      }),
    });

    const response = await PATCH(request, createParams('vid-1'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(updateVideoAssetRecordMock).toHaveBeenCalledWith(
      'vid-1',
      expect.objectContaining({
        folder: 'folder-a',
        tags: ['hero', 'promo'],
        description: 'sample desc',
        displayName: 'My Clip',
        originalUrl: 'https://example.com/a',
        sourceUrl: 'https://example.com/page',
        namespace: 'cf-default',
      })
    );
    expect(upsertRegistryNamespaceMock).toHaveBeenCalledWith('cf-default');
    expect(payload.success).toBe(true);
    expect(payload.displayName).toBe('My Clip');
  });

  it('supports explicit clear semantics except namespace', async () => {
    const request = new NextRequest('http://localhost/api/videos/vid-1/update', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folder: '',
        tags: [],
        description: '',
        displayName: '',
        originalUrl: '',
        sourceUrl: '',
      }),
    });

    const response = await PATCH(request, createParams('vid-1'));
    expect(response.status).toBe(200);
    expect(updateVideoAssetRecordMock).toHaveBeenCalledWith(
      'vid-1',
      expect.objectContaining({
        folder: undefined,
        tags: [],
        description: undefined,
        displayName: undefined,
        originalUrl: undefined,
        sourceUrl: undefined,
      })
    );
    expect(upsertRegistryNamespaceMock).not.toHaveBeenCalled();
  });

  it('rejects empty namespace updates', async () => {
    const request = new NextRequest('http://localhost/api/videos/vid-1/update', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ namespace: '' }),
    });

    const response = await PATCH(request, createParams('vid-1'));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('A non-empty namespace is required.');
    expect(updateVideoAssetRecordMock).not.toHaveBeenCalled();
    expect(upsertRegistryNamespaceMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the video does not exist', async () => {
    getVideoAssetRecordMock.mockResolvedValueOnce(null);

    const request = new NextRequest('http://localhost/api/videos/missing/update', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'x' }),
    });

    const response = await PATCH(request, createParams('missing'));
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toMatch(/not found/i);
    expect(updateVideoAssetRecordMock).not.toHaveBeenCalled();
  });
});
