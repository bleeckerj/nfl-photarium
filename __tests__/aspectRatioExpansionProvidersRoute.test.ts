import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/api/image-tools/aspect-ratio-expand/providers/route';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/image-tools/aspect-ratio-expand/providers', () => {
  it('returns provider status records', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'openai', label: 'OpenAI image edit', available: true }),
      expect.objectContaining({ id: 'comfyui', available: false }),
    ]));
  });
});
