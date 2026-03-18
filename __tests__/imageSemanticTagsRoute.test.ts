import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/images/[id]/tags/route';

const ORIGINAL_ENV = { ...process.env };

function createRequest(body: Record<string, unknown>) {
  const base = new Request('http://localhost/api/images/img-123/tags', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return new NextRequest(base);
}

describe('POST /api/images/:id/tags', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct';
    process.env.CLOUDFLARE_API_TOKEN = 'token';
    process.env.OPENAI_API_KEY = 'openai-key';
    process.env.OPENAI_TAGS_MODEL = 'gpt-4.1-mini';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('generates normalized single-word tags from the image and metadata context', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: {
              id: 'img-123',
              filename: 'museum-scene.png',
              variants: ['https://example.com/public'],
              meta: JSON.stringify({
                folder: 'editorial',
                tags: ['existing-tag'],
              }),
            },
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: 'portrait, gallery, sculpture, frame, lighting',
                },
              },
            ],
          }),
          { status: 200 }
        )
      );

    const response = await POST(createRequest({ count: 5 }), {
      params: Promise.resolve({ id: 'img-123' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.tags).toEqual(['portrait', 'gallery', 'sculpture', 'frame', 'lighting']);
    expect(payload.model).toBe('gpt-4.1-mini');

    const openAiCall = fetchMock.mock.calls[1];
    expect(String(openAiCall?.[0])).toBe('https://api.openai.com/v1/chat/completions');
    const openAiBody = JSON.parse(String(openAiCall?.[1]?.body));
    expect(openAiBody.model).toBe('gpt-4.1-mini');
    expect(openAiBody.messages[1].content[0].text).toContain('Return exactly 5 tags.');
  });
});
