import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  persistComfyVideoWorkflowExtrasMock,
  generateClipTextEmbeddingMock,
  ensureWorkflowIntentIndexMock,
  storeWorkflowIntentEmbeddingMock,
} = vi.hoisted(() => ({
  persistComfyVideoWorkflowExtrasMock: vi.fn(),
  generateClipTextEmbeddingMock: vi.fn(),
  ensureWorkflowIntentIndexMock: vi.fn(),
  storeWorkflowIntentEmbeddingMock: vi.fn(),
}));

vi.mock('@/server/comfy/videoWorkflowExtras', () => ({
  persistComfyVideoWorkflowExtras: persistComfyVideoWorkflowExtrasMock,
}));

vi.mock('@/server/embeddingService', () => ({
  generateClipTextEmbedding: generateClipTextEmbeddingMock,
}));

vi.mock('@/server/comfy/workflowIntentSearch', () => ({
  ensureWorkflowIntentIndex: ensureWorkflowIntentIndexMock,
  storeWorkflowIntentEmbedding: storeWorkflowIntentEmbeddingMock,
}));

import { ingestComfyWorkflowForVideo } from '@/server/comfy/videoWorkflowIngestion';

const ORIGINAL_ENV = process.env.NODE_ENV;
const setNodeEnv = (value: string | undefined) => {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
};

describe('ingestComfyWorkflowForVideo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setNodeEnv('test');
  });

  afterEach(() => {
    setNodeEnv(ORIGINAL_ENV);
  });

  it('returns not-comfy when metadata was not detected', async () => {
    const result = await ingestComfyWorkflowForVideo({
      videoId: 'vid-1',
      comfyExtraction: {
        detected: false,
        sources: [],
      },
    });

    expect(result).toEqual({ persisted: false, indexed: false, reason: 'not-comfy' });
    expect(persistComfyVideoWorkflowExtrasMock).not.toHaveBeenCalled();
  });

  it('returns missing-workflow-json when detection has no workflow payload', async () => {
    const result = await ingestComfyWorkflowForVideo({
      videoId: 'vid-2',
      comfyExtraction: {
        detected: true,
        source: 'video:prompt',
        sources: ['video:prompt'],
      },
    });

    expect(result.reason).toBe('missing-workflow-json');
    expect(persistComfyVideoWorkflowExtrasMock).not.toHaveBeenCalled();
  });

  it('skips embedding/indexing in test mode after persistence', async () => {
    persistComfyVideoWorkflowExtrasMock.mockResolvedValueOnce({
      workflowIntentText: 'prompt_candidates: neon skyline loop',
      promptCandidates: ['neon skyline loop'],
      nodeTypeSignatures: ['CLIPTextEncode', 'SaveVideo'],
      nodeSettingSignatures: [],
      updatedAt: '2026-04-27T00:00:00.000Z',
    });

    const result = await ingestComfyWorkflowForVideo({
      videoId: 'vid-3',
      comfyExtraction: {
        detected: true,
        source: 'video:prompt',
        sources: ['video:prompt'],
        workflowJson: { '1': { class_type: 'CLIPTextEncode', inputs: { text: 'neon skyline loop' } } },
      },
    });

    expect(result).toEqual({ persisted: true, indexed: false, reason: 'embedding-skipped-test' });
    expect(generateClipTextEmbeddingMock).not.toHaveBeenCalled();
  });

  it('indexes workflow intent in non-test mode when embedding is available', async () => {
    setNodeEnv('production');

    persistComfyVideoWorkflowExtrasMock.mockResolvedValueOnce({
      workflowIntentText: 'prompt_candidates: surreal waterfalls',
      promptCandidates: ['surreal waterfalls'],
      nodeTypeSignatures: ['CLIPTextEncode', 'SaveVideo'],
      nodeSettingSignatures: ['SaveVideo(format=mp4)'],
      updatedAt: '2026-04-27T00:00:00.000Z',
    });
    generateClipTextEmbeddingMock.mockResolvedValueOnce(Array.from({ length: 512 }, () => 0.01));

    const result = await ingestComfyWorkflowForVideo({
      videoId: 'vid-4',
      comfyExtraction: {
        detected: true,
        source: 'video:workflow',
        sources: ['video:workflow'],
        workflowJson: { nodes: [{ id: 1, type: 'SaveVideo' }] },
      },
    });

    expect(result).toEqual({ persisted: true, indexed: true, reason: 'ok' });
    expect(ensureWorkflowIntentIndexMock).toHaveBeenCalledTimes(1);
    expect(storeWorkflowIntentEmbeddingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        imageId: 'vid-4',
        workflowIntentText: 'prompt_candidates: surreal waterfalls',
      })
    );
  });
});
