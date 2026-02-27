import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getCachedImagesMock,
  listImageExtrasImageIdsMock,
  deleteImageExtrasRecordMock,
  isWorkflowIntentSearchAvailableMock,
  listWorkflowIntentEmbeddingImageIdsMock,
  deleteWorkflowIntentEmbeddingMock,
} = vi.hoisted(() => ({
  getCachedImagesMock: vi.fn(),
  listImageExtrasImageIdsMock: vi.fn(),
  deleteImageExtrasRecordMock: vi.fn(),
  isWorkflowIntentSearchAvailableMock: vi.fn(),
  listWorkflowIntentEmbeddingImageIdsMock: vi.fn(),
  deleteWorkflowIntentEmbeddingMock: vi.fn(),
}));

vi.mock('@/server/cloudflareImageCache', () => ({
  getCachedImages: getCachedImagesMock,
}));

vi.mock('@/server/imageExtras', () => ({
  listImageExtrasImageIds: listImageExtrasImageIdsMock,
  deleteImageExtrasRecord: deleteImageExtrasRecordMock,
}));

vi.mock('@/server/comfy/workflowIntentSearch', () => ({
  isWorkflowIntentSearchAvailable: isWorkflowIntentSearchAvailableMock,
  listWorkflowIntentEmbeddingImageIds: listWorkflowIntentEmbeddingImageIdsMock,
  deleteWorkflowIntentEmbedding: deleteWorkflowIntentEmbeddingMock,
}));

import {
  auditOrphanedImageArtifacts,
  cleanupOrphanedImageArtifacts,
} from '@/server/imageArtifactOrphanCleanup';

describe('imageArtifactOrphanCleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCachedImagesMock.mockResolvedValue([{ id: 'img-1' }, { id: 'img-2' }]);
    listImageExtrasImageIdsMock.mockResolvedValue(['img-1', 'img-orphan', 'img-orphan']);
    isWorkflowIntentSearchAvailableMock.mockResolvedValue(true);
    listWorkflowIntentEmbeddingImageIdsMock.mockResolvedValue(['img-2', 'wf-orphan']);
  });

  it('audits extras and workflow intent orphans against current Cloudflare ids', async () => {
    const result = await auditOrphanedImageArtifacts({ refreshCloudflareCache: true });

    expect(getCachedImagesMock).toHaveBeenCalledWith(true);
    expect(result.cloudflareImageCount).toBe(2);
    expect(result.targets).toMatchObject([
      {
        target: 'imageExtras',
        status: 'ok',
        scanned: 3,
        orphanedIds: ['img-orphan'],
      },
      {
        target: 'workflowIntentEmbedding',
        status: 'ok',
        scanned: 2,
        orphanedIds: ['wf-orphan'],
      },
    ]);
  });

  it('skips workflow intent audit when index is unavailable', async () => {
    isWorkflowIntentSearchAvailableMock.mockResolvedValue(false);

    const result = await auditOrphanedImageArtifacts();
    const workflow = result.targets.find((entry) => entry.target === 'workflowIntentEmbedding');

    expect(workflow).toMatchObject({
      status: 'skipped',
      reason: 'workflow-intent-search-unavailable',
      scanned: 0,
      orphanedIds: [],
    });
    expect(listWorkflowIntentEmbeddingImageIdsMock).not.toHaveBeenCalled();
  });

  it('supports dry-run cleanup without deleting anything', async () => {
    const result = await cleanupOrphanedImageArtifacts({ apply: false });

    expect(deleteImageExtrasRecordMock).not.toHaveBeenCalled();
    expect(deleteWorkflowIntentEmbeddingMock).not.toHaveBeenCalled();
    expect(result.targets[0].deletedIds).toEqual([]);
    expect(result.targets[0].apply).toBe(false);
  });

  it('deletes orphaned records in apply mode and reports per-target failures', async () => {
    deleteWorkflowIntentEmbeddingMock.mockRejectedValueOnce(new Error('redis down'));

    const result = await cleanupOrphanedImageArtifacts({ apply: true });
    const extras = result.targets.find((entry) => entry.target === 'imageExtras');
    const workflow = result.targets.find((entry) => entry.target === 'workflowIntentEmbedding');

    expect(deleteImageExtrasRecordMock).toHaveBeenCalledWith('img-orphan');
    expect(deleteWorkflowIntentEmbeddingMock).toHaveBeenCalledWith('wf-orphan');
    expect(extras).toMatchObject({
      status: 'ok',
      deletedIds: ['img-orphan'],
      failedDeletes: [],
    });
    expect(workflow).toMatchObject({
      status: 'failed',
      deletedIds: [],
      failedDeletes: [{ imageId: 'wf-orphan', error: 'redis down' }],
    });
  });
});

