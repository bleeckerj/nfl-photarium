import { beforeEach, describe, expect, it, vi } from 'vitest';

const extrasState = new Map<string, unknown>();

vi.mock('@/server/extrasStorage', () => ({
  getExtrasStorage: () => ({
    get: async <T>(key: string) => (extrasState.has(key) ? (extrasState.get(key) as T) : null),
    getMany: async <T>(keys: string[]) =>
      Object.fromEntries(
        keys.map((key) => [key, extrasState.has(key) ? (extrasState.get(key) as T) : null])
      ),
    set: async <T>(key: string, value: T) => {
      extrasState.set(key, value);
    },
    delete: async (key: string) => {
      extrasState.delete(key);
    },
    exists: async (key: string) => extrasState.has(key),
  }),
}));

import { getImageExtrasRecord, patchImageExtrasRecord } from '@/server/imageExtras';
import {
  buildComfyWorkflowEntry,
  getComfyWorkflowExtras,
  persistComfyWorkflowExtras,
} from '@/server/comfy/workflowExtras';

describe('workflowExtras', () => {
  beforeEach(() => {
    extrasState.clear();
  });

  it('builds a workflow extras entry with prompt candidates and versioned fields', () => {
    const entry = buildComfyWorkflowEntry({
      workflowJson: {
        '1': { class_type: 'CLIPTextEncode', inputs: { text: 'sunlit brutalist interior' } },
        '2': { class_type: 'KSampler', inputs: { steps: 30, cfg: 7 } },
      },
      imageDescription: {
        altText: 'Interior of a concrete building with angled shadows',
      },
      embeddingModel: 'clip-ViT-B-32',
      embeddingVersion: 'v1',
      updatedAt: '2026-02-07T00:00:00.000Z',
    });

    expect(entry).not.toBeNull();
    expect(entry?.promptCandidates).toEqual(['sunlit brutalist interior']);
    expect(entry?.intentTextVersion).toBe('v1');
    expect(entry?.embeddingModel).toBe('clip-ViT-B-32');
    expect(entry?.embeddingVersion).toBe('v1');
    expect(entry?.updatedAt).toBe('2026-02-07T00:00:00.000Z');
  });

  it('persists comfy workflow extras while preserving existing promptThis data', async () => {
    const imageId = 'img-123';

    await patchImageExtrasRecord(imageId, {
      promptThis: {
        prompt: 'existing user prompt',
        model: 'manual',
        provider: 'manual',
        createdAt: '2026-02-07T00:00:00.000Z',
        updatedAt: '2026-02-07T00:00:00.000Z',
      },
    });

    const persisted = await persistComfyWorkflowExtras({
      imageId,
      workflowJson: {
        '1': { class_type: 'CLIPTextEncode', inputs: { text: 'retro synthwave cityscape' } },
        '2': { class_type: 'KSampler', inputs: { steps: 25, cfg: 6.5, sampler_name: 'euler' } },
      },
      imageDescription: {
        description: 'Magenta and cyan skyline with glossy roads',
      },
      embeddingModel: 'clip-ViT-B-32',
      embeddingVersion: 'v1',
    });

    expect(persisted).not.toBeNull();

    const extras = await getImageExtrasRecord(imageId);
    expect(extras?.promptThis?.prompt).toBe('existing user prompt');
    expect(extras?.comfyWorkflow?.promptCandidates).toEqual(['retro synthwave cityscape']);
    expect(extras?.comfyWorkflow?.imageDescription?.description).toBe(
      'Magenta and cyan skyline with glossy roads'
    );

    const workflowOnly = await getComfyWorkflowExtras(imageId);
    expect(workflowOnly?.workflowIntentText).toContain('node_types: CLIPTextEncode, KSampler');
  });

  it('returns null and skips persistence when workflow payload has no usable signal', async () => {
    const imageId = 'img-empty';
    const result = await persistComfyWorkflowExtras({
      imageId,
      workflowJson: { foo: 'bar' },
    });

    expect(result).toBeNull();
    const extras = await getImageExtrasRecord(imageId);
    expect(extras).toBeNull();
  });
});
