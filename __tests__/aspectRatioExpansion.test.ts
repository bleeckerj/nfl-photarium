import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getAspectRatioExpansionProviderStatuses,
  resolveAspectRatioExpansionProvider,
} from '@/server/aspectRatioExpansion/registry';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('aspect-ratio expansion provider resolution', () => {
  it('prefers OpenAI in automatic mode when both providers are configured', () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubEnv('COMFY_BASE_URL', 'http://127.0.0.1:8188');
    vi.stubEnv('COMFY_ASPECT_RATIO_WORKFLOW_PATH', '/tmp/aspect-ratio-workflow.json');
    vi.stubEnv('PHOTARIUM_ASPECT_RATIO_PROVIDER', 'auto');

    expect(resolveAspectRatioExpansionProvider('auto').id).toBe('openai');
  });

  it('uses ComfyUI automatically when OpenAI is not configured', () => {
    vi.stubEnv('COMFY_BASE_URL', 'http://127.0.0.1:8188');
    vi.stubEnv('COMFY_ASPECT_RATIO_WORKFLOW_PATH', '/tmp/aspect-ratio-workflow.json');
    vi.stubEnv('PHOTARIUM_ASPECT_RATIO_PROVIDER', 'auto');

    expect(resolveAspectRatioExpansionProvider('auto').id).toBe('comfyui');
  });

  it('fails explicitly selected unavailable providers without fallback', () => {
    expect(() => resolveAspectRatioExpansionProvider('openai')).toThrow(/OPENAI_API_KEY/i);
  });

  it('reports provider availability without exposing credentials', () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    const statuses = getAspectRatioExpansionProviderStatuses();

    expect(statuses).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'openai', available: true }),
      expect.objectContaining({ id: 'comfyui', available: false }),
    ]));
    expect(JSON.stringify(statuses)).not.toContain('test-key');
  });
});
