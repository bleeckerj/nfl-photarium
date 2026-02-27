import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  removeCachedImageMock,
  deleteImageExtrasRecordMock,
  isVectorSearchAvailableMock,
  deleteImageVectorsMock,
  isWorkflowIntentSearchAvailableMock,
  deleteWorkflowIntentEmbeddingMock,
} = vi.hoisted(() => ({
  removeCachedImageMock: vi.fn(),
  deleteImageExtrasRecordMock: vi.fn(),
  isVectorSearchAvailableMock: vi.fn(),
  deleteImageVectorsMock: vi.fn(),
  isWorkflowIntentSearchAvailableMock: vi.fn(),
  deleteWorkflowIntentEmbeddingMock: vi.fn(),
}));

vi.mock('@/server/cloudflareImageCache', () => ({
  removeCachedImage: removeCachedImageMock,
}));

vi.mock('@/server/imageExtras', () => ({
  deleteImageExtrasRecord: deleteImageExtrasRecordMock,
}));

vi.mock('@/server/vectorSearch', () => ({
  isVectorSearchAvailable: isVectorSearchAvailableMock,
  deleteImageVectors: deleteImageVectorsMock,
}));

vi.mock('@/server/comfy/workflowIntentSearch', () => ({
  isWorkflowIntentSearchAvailable: isWorkflowIntentSearchAvailableMock,
  deleteWorkflowIntentEmbedding: deleteWorkflowIntentEmbeddingMock,
}));

import { cleanupImageArtifacts } from '@/server/imageArtifactCleanup';

describe('cleanupImageArtifacts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isVectorSearchAvailableMock.mockResolvedValue(true);
    isWorkflowIntentSearchAvailableMock.mockResolvedValue(true);
  });

  it('cleans all configured image artifacts when backends are available', async () => {
    const result = await cleanupImageArtifacts('img-123');

    expect(removeCachedImageMock).toHaveBeenCalledWith('img-123');
    expect(deleteImageVectorsMock).toHaveBeenCalledWith('img-123');
    expect(deleteImageExtrasRecordMock).toHaveBeenCalledWith('img-123');
    expect(deleteWorkflowIntentEmbeddingMock).toHaveBeenCalledWith('img-123');
    expect(result.success).toBe(true);
    expect(result.steps.map((step) => [step.step, step.status])).toEqual([
      ['cloudflareCache', 'success'],
      ['imageVectors', 'success'],
      ['imageExtras', 'success'],
      ['workflowIntentEmbedding', 'success'],
    ]);
  });

  it('skips optional embedding cleanup when indexes are unavailable', async () => {
    isVectorSearchAvailableMock.mockResolvedValue(false);
    isWorkflowIntentSearchAvailableMock.mockResolvedValue(false);

    const result = await cleanupImageArtifacts('img-456');

    expect(deleteImageVectorsMock).not.toHaveBeenCalled();
    expect(deleteWorkflowIntentEmbeddingMock).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.steps.find((step) => step.step === 'imageVectors')).toMatchObject({
      status: 'skipped',
      reason: 'vector-search-unavailable',
    });
    expect(result.steps.find((step) => step.step === 'workflowIntentEmbedding')).toMatchObject({
      status: 'skipped',
      reason: 'workflow-intent-search-unavailable',
    });
  });

  it('reports failure for one cleanup step without skipping the rest', async () => {
    deleteImageExtrasRecordMock.mockRejectedValueOnce(new Error('extras delete failed'));

    const result = await cleanupImageArtifacts('img-789');

    expect(deleteWorkflowIntentEmbeddingMock).toHaveBeenCalledWith('img-789');
    expect(result.success).toBe(false);
    expect(result.steps.find((step) => step.step === 'imageExtras')).toMatchObject({
      status: 'failed',
      error: 'extras delete failed',
    });
  });

  it('can disable selected cleanup steps', async () => {
    const result = await cleanupImageArtifacts('img-000', {
      includeVectors: false,
      includeWorkflowIntentEmbedding: false,
    });

    expect(deleteImageVectorsMock).not.toHaveBeenCalled();
    expect(deleteWorkflowIntentEmbeddingMock).not.toHaveBeenCalled();
    expect(result.steps.map((step) => step.step)).toEqual(['cloudflareCache', 'imageExtras']);
  });
});

