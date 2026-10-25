import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/images/[id]/haiku/route';

const { availableMock, vectorsMock, embeddingMock } = vi.hoisted(() => ({
  availableMock: vi.fn(), vectorsMock: vi.fn(), embeddingMock: vi.fn(),
}));
vi.mock('@/server/vectorSearch', () => ({
  isVectorSearchAvailable: availableMock, getImageVectors: vectorsMock,
}));
vi.mock('@/server/embeddingService', () => ({ generateClipTextEmbedding: embeddingMock }));

describe('haiku completion requests', () => {
  beforeEach(() => {
    availableMock.mockResolvedValue(true);
    vectorsMock.mockResolvedValue({ clipEmbedding: [1, 0], dominantColors: ['blue'] });
    embeddingMock.mockResolvedValue([1, 0]);
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubEnv('OPENAI_IMAGE_METADATA_MODEL', '');
    vi.stubEnv('OPENAI_HAIKU_MODEL', '');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each([
    ['gpt-5.6-luna', { max_completion_tokens: 100, reasoning_effort: 'none' }],
    ['gpt-4.1-mini', { max_tokens: 100, temperature: 0.9 }],
  ])('keeps the haiku response contract with %s', async (model, options) => {
    vi.stubEnv('OPENAI_HAIKU_MODEL', model);
    const haiku = 'Quiet currents flow\nShadows gather in the blue\nMorning wakes the glass';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: haiku } }],
    })));
    const response = await POST(new NextRequest('http://localhost/api/images/img-123/haiku', { method: 'POST' }), {
      params: Promise.resolve({ id: 'img-123' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ haiku, lines: haiku.split('\n') });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toMatchObject({ model, ...options });
    if (model === 'gpt-5.6-luna') {
      expect(body).not.toHaveProperty('max_tokens');
      expect(body).not.toHaveProperty('temperature');
    }
  });

  it('does not report success for a provider failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      error: { message: 'model unavailable' },
    }), { status: 404 }));
    const response = await POST(new NextRequest('http://localhost/api/images/img-123/haiku', { method: 'POST' }), {
      params: Promise.resolve({ id: 'img-123' }),
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'model unavailable' });
  });
});
