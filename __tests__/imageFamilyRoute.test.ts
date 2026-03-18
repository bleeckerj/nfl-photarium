import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  getCachedImagesMock,
  listVideoAssetRecordsWithSyncMock,
} = vi.hoisted(() => ({
  getCachedImagesMock: vi.fn(),
  listVideoAssetRecordsWithSyncMock: vi.fn(),
}));

vi.mock('@/server/cloudflareImageCache', () => ({
  getCachedImages: getCachedImagesMock,
}));

vi.mock('@/server/videoCatalogStorage', () => ({
  listVideoAssetRecordsWithSync: listVideoAssetRecordsWithSyncMock,
}));

import { GET } from '@/app/api/images/[id]/family/route';

describe('GET /api/images/:id/family', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENABLE_VIDEO_ASSETS = '1';
  });

  it('returns only the target family by default', async () => {
    getCachedImagesMock.mockResolvedValue([
      {
        id: 'parent',
        filename: 'parent.jpg',
        namespace: 'alpha',
        uploaded: '2026-02-20T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/parent/public'],
        tags: [],
      },
      {
        id: 'child-a',
        filename: 'child-a.jpg',
        namespace: 'alpha',
        parentId: 'parent',
        uploaded: '2026-02-20T00:05:00.000Z',
        variants: ['https://imagedelivery.net/hash/child-a/public'],
        tags: [],
      },
      {
        id: 'child-b',
        filename: 'child-b.jpg',
        namespace: 'beta',
        parentId: 'parent',
        uploaded: '2026-02-20T00:06:00.000Z',
        variants: ['https://imagedelivery.net/hash/child-b/public'],
        tags: [],
      },
      {
        id: 'other',
        filename: 'other.jpg',
        namespace: 'alpha',
        uploaded: '2026-02-20T00:07:00.000Z',
        variants: ['https://imagedelivery.net/hash/other/public'],
        tags: [],
      },
    ]);
    listVideoAssetRecordsWithSyncMock.mockResolvedValue([
      {
        id: 'vid-child',
        filename: 'child.mp4',
        namespace: 'gamma',
        parentId: 'parent',
        uploaded: '2026-02-20T00:10:00.000Z',
        streamUid: 'stream-child',
        playbackUrl: 'https://videodelivery.net/stream-child/iframe',
        videoStatus: 'ready',
        tags: [],
        createdAt: '2026-02-20T00:10:00.000Z',
        updatedAt: '2026-02-20T00:10:00.000Z',
      },
    ]);

    const response = await GET(
      new NextRequest('http://localhost/api/images/child-a/family'),
      { params: Promise.resolve({ id: 'child-a' }) }
    );
    const payload = await response.json();
    const ids = payload.familyAssets.map((entry: { id: string }) => entry.id);

    expect(response.status).toBe(200);
    expect(ids).toEqual(expect.arrayContaining(['parent', 'child-a', 'child-b', 'vid-child']));
    expect(ids).not.toContain('other');
    expect(payload.candidateAssets).toEqual([]);
  });

  it('returns namespace-scoped canonical candidates when requested', async () => {
    getCachedImagesMock.mockResolvedValue([
      {
        id: 'parent',
        filename: 'parent.jpg',
        namespace: 'alpha',
        uploaded: '2026-02-20T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/parent/public'],
        tags: [],
      },
      {
        id: 'child-a',
        filename: 'child-a.jpg',
        namespace: 'alpha',
        parentId: 'parent',
        uploaded: '2026-02-20T00:05:00.000Z',
        variants: ['https://imagedelivery.net/hash/child-a/public'],
        tags: [],
      },
      {
        id: 'candidate-a',
        filename: 'candidate-a.jpg',
        namespace: 'alpha',
        uploaded: '2026-02-20T00:06:00.000Z',
        variants: ['https://imagedelivery.net/hash/candidate-a/public'],
        tags: [],
      },
      {
        id: 'candidate-b',
        filename: 'candidate-b.jpg',
        namespace: 'beta',
        uploaded: '2026-02-20T00:07:00.000Z',
        variants: ['https://imagedelivery.net/hash/candidate-b/public'],
        tags: [],
      },
    ]);
    listVideoAssetRecordsWithSyncMock.mockResolvedValue([]);

    const response = await GET(
      new NextRequest('http://localhost/api/images/child-a/family?includeCandidates=1'),
      { params: Promise.resolve({ id: 'child-a' }) }
    );
    const payload = await response.json();
    const candidateIds = payload.candidateAssets.map((entry: { id: string }) => entry.id);

    expect(response.status).toBe(200);
    expect(candidateIds).toEqual(['candidate-a']);
  });
});
