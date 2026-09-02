import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const extras = vi.hoisted(() => new Map<string, unknown>());

vi.mock('@/server/extrasStorage', () => ({
  getExtrasStorage: () => ({
    get: async <T>(key: string) => (extras.get(key) as T | undefined) ?? null,
    getMany: async () => ({}),
    set: async <T>(key: string, value: T) => { extras.set(key, value); },
    delete: async (key: string) => { extras.delete(key); },
    listKeysByPrefix: async () => [],
    exists: async (key: string) => extras.has(key),
  }),
}));

import {
  aspectRatioToSize,
  createCreativeBriefPlan,
  normalizeAspectRatio,
  normalizeGenerationProvider,
  normalizeSourceRelationship,
  appendPromptDerivation,
  getPromptDerivations,
  updatePromptDerivation,
} from '@/server/creativeBrief';
import { prepareDirectCreativeBriefHandoff } from '@/server/image-tools/creativeBriefHandoff';
import { creativeBriefAdapter } from '@/server/image-tools/creativeBriefAdapter';

beforeEach(() => extras.clear());
afterEach(() => vi.unstubAllGlobals());

describe('creative brief helpers', () => {
  it('normalizes common aspect-ratio spellings', () => {
    expect(normalizeAspectRatio('4/5')).toBe('4:5');
    expect(normalizeAspectRatio('16x9')).toBe('16:9');
    expect(normalizeAspectRatio('1:1')).toBe('1:1');
    expect(aspectRatioToSize('4:5')).toBe('1024x1280');
  });

  it('rejects invalid aspect ratios and relationships', () => {
    expect(() => normalizeAspectRatio('wide')).toThrow('Invalid aspectRatio');
    expect(() => normalizeSourceRelationship('copy')).toThrow('Invalid sourceRelationship');
    expect(() => normalizeGenerationProvider('unknown')).toThrow('Invalid provider');
  });

  it('defaults a creative brief plan to a subject reference and brief-led relationship', () => {
    expect(createCreativeBriefPlan({
      sourceImageId: 'source-1',
      creativeBrief: 'Reinterpret as a solarpunk product study.',
      prompt: 'A detailed prompt',
    })).toMatchObject({
      sourceImageId: 'source-1',
      sourceRelationship: 'brief_led',
      references: [{ imageId: 'source-1', role: 'subject_reference' }],
    });
  });

  it('persists a derivation and records an externally generated child', async () => {
    const plan = createCreativeBriefPlan({
      sourceImageId: 'source-2',
      creativeBrief: 'Rebrand as an Apple II-era computer.',
      prompt: 'A beige period computer with a rainbow Apple logo.',
      sourceRelationship: 'related_design',
      aspectRatio: '4:5',
      provider: 'codex_imagegen',
    });
    const record = {
      ...plan,
      createdAt: '2026-07-26T00:00:00.000Z',
      updatedAt: '2026-07-26T00:00:00.000Z',
    };

    await appendPromptDerivation(record);
    const updated = await updatePromptDerivation('source-2', plan.derivationId, {
      provider: 'comfyui',
      generatedImageId: 'child-2',
      externalJobId: 'job-2',
      actualDimensions: { width: 1024, height: 1280 },
      actualAspectRatio: '4:5',
    });

    expect(await getPromptDerivations('source-2')).toEqual([
      expect.objectContaining({
        derivationId: plan.derivationId,
        provider: 'comfyui',
        generatedImageId: 'child-2',
        externalJobId: 'job-2',
        actualDimensions: { width: 1024, height: 1280 },
        actualAspectRatio: '4:5',
      }),
    ]);
    expect(updated.updatedAt).not.toBe(record.updatedAt);
  });

  it('persists a direct handoff without rewriting the prompt', async () => {
    const prompt = 'Preserve every edge and label; reinterpret this object as a translucent archival instrument.';
    const result = await prepareDirectCreativeBriefHandoff('source-direct', {
      prompt,
      sourceRelationship: 'faithful_adaptation',
      aspectRatio: '4:5',
      provider: 'codex_imagegen',
    });

    expect(result.prompt).toBe(prompt);
    expect(result.plan).toMatchObject({
      promptMode: 'direct',
      sourceImageId: 'source-direct',
      sourceVariant: 'original',
      prompt,
      sourceRelationship: 'faithful_adaptation',
      aspectRatio: '4:5',
      provider: 'codex_imagegen',
      references: [{ imageId: 'source-direct', role: 'subject_reference' }],
    });
    expect(await getPromptDerivations('source-direct')).toEqual([result.derivation]);
  });

  it('rejects an empty direct prompt', async () => {
    await expect(prepareDirectCreativeBriefHandoff('source-direct', { prompt: '   ' })).rejects.toThrow('Prompt is required');
  });

  it('runs the executable provider and returns an uploaded image result', async () => {
    const prompt = 'Generate this source as an archival instrument with its complete composition preserved.';
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://127.0.0.1:8787/tools/photarium_generate_from_creative_brief');
      expect(JSON.parse(String(init?.body))).toMatchObject({
        imageId: 'source-run',
        prompt,
        provider: 'photarium_openai',
      });
      return new Response(JSON.stringify({
        ok: true,
        result: {
          content: [{
            type: 'text',
            text: JSON.stringify({
              plan: { derivationId: 'derivation-run', sourceImageId: 'source-run', promptMode: 'direct', sourceVariant: 'original', prompt },
              result: { imageId: 'child-run', url: 'https://imagedelivery.net/example/child-run/public' },
              metadataEnrichment: { status: 'completed' },
            }),
          }],
        },
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await creativeBriefAdapter.run({
      runId: 'run-1',
      imageId: 'source-run',
      request: {
        effectId: 'creative-brief',
        params: { prompt, provider: 'photarium_openai', sourceRelationship: 'brief_led' },
        output: { mode: 'still', format: 'png' },
      },
      updateRun: vi.fn(),
      addEvent: vi.fn(),
    });

    expect(result).toMatchObject({ kind: 'image', state: 'uploaded', prompt, uploadedAsset: { id: 'child-run' } });
  });
});
