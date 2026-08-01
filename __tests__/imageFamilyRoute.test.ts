import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  getCachedImagesMock,
  getCacheStatsMock,
  listVideoAssetRecordsWithSyncMock,
  getVideoAssetCatalogVersionMock,
  getImageExtrasRecordsMock,
  getImageFolderOverridesMock,
  getImageFolderOverridesVersionMock,
} = vi.hoisted(() => ({
  getCachedImagesMock: vi.fn(),
  getCacheStatsMock: vi.fn(),
  listVideoAssetRecordsWithSyncMock: vi.fn(),
  getVideoAssetCatalogVersionMock: vi.fn(),
  getImageExtrasRecordsMock: vi.fn(),
  getImageFolderOverridesMock: vi.fn(),
  getImageFolderOverridesVersionMock: vi.fn(),
}));

vi.mock('@/server/cloudflareImageCache', () => ({
  getCachedImages: getCachedImagesMock,
  getCacheStats: getCacheStatsMock,
}));

vi.mock('@/server/videoCatalogStorage', () => ({
  listVideoAssetRecordsWithSync: listVideoAssetRecordsWithSyncMock,
  getVideoAssetCatalogVersion: getVideoAssetCatalogVersionMock,
}));

vi.mock('@/server/imageExtras', () => ({
  getImageExtrasRecords: getImageExtrasRecordsMock,
  getImageFolderOverrides: getImageFolderOverridesMock,
  getImageFolderOverridesVersion: getImageFolderOverridesVersionMock,
}));

import { GET } from '@/app/api/images/[id]/family/route';
import { clearFamilyCandidatePoolMemo } from '@/server/familyCandidatePool';

describe('GET /api/images/:id/family', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The candidate-pool memo keys on these version counters; with constant
    // mocked versions the key never changes, so clear it between tests.
    clearFamilyCandidatePoolMemo();
    process.env.ENABLE_VIDEO_ASSETS = '1';
    getImageExtrasRecordsMock.mockResolvedValue({});
    getCacheStatsMock.mockReturnValue({ contentVersion: 1 });
    getVideoAssetCatalogVersionMock.mockReturnValue(1);
    getImageFolderOverridesMock.mockResolvedValue(new Map());
    getImageFolderOverridesVersionMock.mockReturnValue(1);
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

  it('returns same-namespace candidates plus cross-namespace orphans when requested', async () => {
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
        id: 'other-parent',
        filename: 'other-parent.jpg',
        namespace: 'alpha',
        uploaded: '2026-02-20T00:06:30.000Z',
        variants: ['https://imagedelivery.net/hash/other-parent/public'],
        tags: [],
      },
      {
        id: 'assigned-elsewhere',
        filename: 'assigned-elsewhere.jpg',
        namespace: 'alpha',
        parentId: 'other-parent',
        uploaded: '2026-02-20T00:06:45.000Z',
        variants: ['https://imagedelivery.net/hash/assigned-elsewhere/public'],
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
    getImageExtrasRecordsMock.mockResolvedValue({
      'candidate-a': {
        imageId: 'candidate-a',
        folder: 'extras-folder',
        description: 'Detailed candidate description',
        altText: 'Candidate alt text',
      },
    });

    const response = await GET(
      new NextRequest('http://localhost/api/images/child-a/family?includeCandidates=1'),
      { params: Promise.resolve({ id: 'child-a' }) }
    );
    const payload = await response.json();
    const candidateIds = payload.candidateAssets.map((entry: { id: string }) => entry.id);

    expect(response.status).toBe(200);
    // The pool is the full slim catalog; availability classification happens
    // client-side (parentReassignmentUtils), so the wrapper array is gone.
    expect(payload.assignmentCandidates).toBeUndefined();
    expect(candidateIds).toEqual([
      'parent',
      'child-a',
      'candidate-a',
      'other-parent',
      'assigned-elsewhere',
      'candidate-b',
    ]);
    const candidateA = payload.candidateAssets.find(
      (entry: { id: string }) => entry.id === 'candidate-a'
    );
    expect(candidateA).toEqual(
      expect.objectContaining({
        id: 'candidate-a',
        folder: 'extras-folder',
        description: 'Detailed candidate description',
        altText: 'Candidate alt text',
      })
    );
    // Slim projection: image entries carry no variants array (only videos
    // do) and none of the heavy detail-only fields.
    expect(candidateA).not.toHaveProperty('variants');
    expect(candidateA).not.toHaveProperty('promptThis');
    expect(candidateA).not.toHaveProperty('dimensions');
    expect(candidateA).not.toHaveProperty('size');
  });

  it('excludes a detached former child from the old parent family', async () => {
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
        id: 'detached-child',
        filename: 'detached-child.jpg',
        namespace: 'alpha',
        uploaded: '2026-02-20T00:05:00.000Z',
        variants: ['https://imagedelivery.net/hash/detached-child/public'],
        tags: [],
      },
      {
        id: 'attached-child',
        filename: 'attached-child.jpg',
        namespace: 'alpha',
        parentId: 'parent',
        uploaded: '2026-02-20T00:06:00.000Z',
        variants: ['https://imagedelivery.net/hash/attached-child/public'],
        tags: [],
      },
    ]);
    listVideoAssetRecordsWithSyncMock.mockResolvedValue([]);

    const response = await GET(
      new NextRequest('http://localhost/api/images/parent/family'),
      { params: Promise.resolve({ id: 'parent' }) }
    );
    const payload = await response.json();
    const ids = payload.familyAssets.map((entry: { id: string }) => entry.id);

    expect(response.status).toBe(200);
    expect(payload.familyRootId).toBe('parent');
    expect(ids).toEqual(expect.arrayContaining(['parent', 'attached-child']));
    expect(ids).not.toContain('detached-child');
  });

  it('treats a detached child as its own family root', async () => {
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
        id: 'detached-child',
        filename: 'detached-child.jpg',
        namespace: 'alpha',
        uploaded: '2026-02-20T00:05:00.000Z',
        variants: ['https://imagedelivery.net/hash/detached-child/public'],
        tags: [],
      },
    ]);
    listVideoAssetRecordsWithSyncMock.mockResolvedValue([]);

    const response = await GET(
      new NextRequest('http://localhost/api/images/detached-child/family'),
      { params: Promise.resolve({ id: 'detached-child' }) }
    );
    const payload = await response.json();
    const ids = payload.familyAssets.map((entry: { id: string }) => entry.id);

    expect(response.status).toBe(200);
    expect(payload.familyRootId).toBe('detached-child');
    expect(ids).toEqual(['detached-child']);
    expect(payload.parent).toEqual(expect.objectContaining({ id: 'detached-child' }));
    expect(payload.children).toEqual([]);
  });
});
