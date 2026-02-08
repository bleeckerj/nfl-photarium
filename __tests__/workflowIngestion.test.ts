import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  persistComfyWorkflowExtrasMock,
  generateClipTextEmbeddingMock,
  ensureWorkflowIntentIndexMock,
  storeWorkflowIntentEmbeddingMock,
} = vi.hoisted(() => ({
  persistComfyWorkflowExtrasMock: vi.fn(),
  generateClipTextEmbeddingMock: vi.fn(),
  ensureWorkflowIntentIndexMock: vi.fn(),
  storeWorkflowIntentEmbeddingMock: vi.fn(),
}));

vi.mock('@/server/comfy/workflowExtras', () => ({
  persistComfyWorkflowExtras: persistComfyWorkflowExtrasMock,
}));

vi.mock('@/server/embeddingService', () => ({
  generateClipTextEmbedding: generateClipTextEmbeddingMock,
}));

vi.mock('@/server/comfy/workflowIntentSearch', () => ({
  ensureWorkflowIntentIndex: ensureWorkflowIntentIndexMock,
  storeWorkflowIntentEmbedding: storeWorkflowIntentEmbeddingMock,
}));

import { ingestComfyWorkflowForImage } from '@/server/comfy/workflowIngestion';

const ORIGINAL_ENV = process.env.NODE_ENV;

describe('ingestComfyWorkflowForImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_ENV;
  });

  it('returns not-comfy when metadata was not detected', async () => {
    const result = await ingestComfyWorkflowForImage({
      imageId: 'img-1',
      comfyExtraction: {
        detected: false,
        sources: [],
      },
    });

    expect(result).toEqual({ persisted: false, indexed: false, reason: 'not-comfy' });
    expect(persistComfyWorkflowExtrasMock).not.toHaveBeenCalled();
  });

  it('returns missing-workflow-json when detection has no workflow payload', async () => {
    const result = await ingestComfyWorkflowForImage({
      imageId: 'img-2',
      comfyExtraction: {
        detected: true,
        source: 'png:prompt',
        sources: ['png:prompt'],
      },
    });

    expect(result.reason).toBe('missing-workflow-json');
    expect(persistComfyWorkflowExtrasMock).not.toHaveBeenCalled();
  });

  it('returns persistence-failed when extras persistence throws', async () => {
    persistComfyWorkflowExtrasMock.mockRejectedValueOnce(new Error('disk write failed'));

    const result = await ingestComfyWorkflowForImage({
      imageId: 'img-3',
      comfyExtraction: {
        detected: true,
        source: 'png:prompt',
        sources: ['png:prompt'],
        workflowJson: { '1': { class_type: 'CLIPTextEncode', inputs: { text: 'hello' } } },
      },
    });

    expect(result.reason).toBe('persistence-failed');
  });

  it('skips embedding/indexing in test mode after persistence', async () => {
    persistComfyWorkflowExtrasMock.mockResolvedValueOnce({
      workflowIntentText: 'prompt_candidates: test',
      promptCandidates: ['test'],
      nodeTypeSignatures: ['CLIPTextEncode'],
      nodeSettingSignatures: [],
      updatedAt: '2026-02-07T00:00:00.000Z',
    });

    const result = await ingestComfyWorkflowForImage({
      imageId: 'img-4',
      comfyExtraction: {
        detected: true,
        source: 'png:prompt',
        sources: ['png:prompt'],
        workflowJson: { '1': { class_type: 'CLIPTextEncode', inputs: { text: 'test' } } },
      },
    });

    expect(result).toEqual({ persisted: true, indexed: false, reason: 'embedding-skipped-test' });
    expect(generateClipTextEmbeddingMock).not.toHaveBeenCalled();
  });

  it('indexes workflow intent in non-test mode when embedding is available', async () => {
    process.env.NODE_ENV = 'production';

    persistComfyWorkflowExtrasMock.mockResolvedValueOnce({
      workflowIntentText: 'prompt_candidates: moody portrait',
      promptCandidates: ['moody portrait'],
      nodeTypeSignatures: ['CLIPTextEncode', 'KSampler'],
      nodeSettingSignatures: ['KSampler(steps=30,cfg=7)'],
      updatedAt: '2026-02-07T00:00:00.000Z',
    });
    generateClipTextEmbeddingMock.mockResolvedValueOnce(Array.from({ length: 512 }, () => 0.01));

    const result = await ingestComfyWorkflowForImage({
      imageId: 'img-5',
      comfyExtraction: {
        detected: true,
        source: 'png:prompt',
        sources: ['png:prompt'],
        workflowJson: { '1': { class_type: 'CLIPTextEncode', inputs: { text: 'moody portrait' } } },
      },
      embeddingModel: 'clip-ViT-B-32',
      embeddingVersion: 'v1',
    });

    expect(result).toEqual({ persisted: true, indexed: true, reason: 'ok' });
    expect(ensureWorkflowIntentIndexMock).toHaveBeenCalledTimes(1);
    expect(storeWorkflowIntentEmbeddingMock).toHaveBeenCalledTimes(1);
  });
});
