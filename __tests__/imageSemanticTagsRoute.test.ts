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
  const mockImageResponse = () =>
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
    );

  const mockTagResponse = (content: string) =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content,
            },
          },
        ],
      }),
      { status: 200 }
    );

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
      .mockResolvedValueOnce(mockImageResponse())
      .mockResolvedValueOnce(mockTagResponse('portrait, gallery, sculpture, frame, lighting'));

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

  it('splits a hyphen-collapsed model response into separate tags', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    fetchMock
      .mockResolvedValueOnce(mockImageResponse())
      .mockResolvedValueOnce(mockTagResponse('apple-logo-rainbow-colors-fruit-technology-vintage'));

    const response = await POST(createRequest({ count: 6 }), {
      params: Promise.resolve({ id: 'img-123' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.tags).toEqual(['apple', 'logo', 'rainbow', 'colors', 'fruit', 'technology']);
  });

  it('defaults to gpt-4.1-nano when no tag model overrides are set', async () => {
    delete process.env.OPENAI_TAGS_MODEL;
    delete process.env.OPENAI_DISPLAY_NAME_MODEL;

    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock
      .mockResolvedValueOnce(mockImageResponse())
      .mockResolvedValueOnce(mockTagResponse('portrait, gallery, sculpture, frame, lighting'));

    const response = await POST(createRequest({ count: 5 }), {
      params: Promise.resolve({ id: 'img-123' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.model).toBe('gpt-4.1-nano');

    const openAiCall = fetchMock.mock.calls[1];
    const openAiBody = JSON.parse(String(openAiCall?.[1]?.body));
    expect(openAiBody.model).toBe('gpt-4.1-nano');
  });

  it('prefers OPENAI_TAGS_MODEL over OPENAI_DISPLAY_NAME_MODEL', async () => {
    process.env.OPENAI_TAGS_MODEL = 'gpt-4.1-nano';
    process.env.OPENAI_DISPLAY_NAME_MODEL = 'gpt-5-mini';

    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock
      .mockResolvedValueOnce(mockImageResponse())
      .mockResolvedValueOnce(mockTagResponse('portrait, gallery, sculpture, frame, lighting'));

    const response = await POST(createRequest({ count: 5 }), {
      params: Promise.resolve({ id: 'img-123' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.model).toBe('gpt-4.1-nano');

    const openAiCall = fetchMock.mock.calls[1];
    const openAiBody = JSON.parse(String(openAiCall?.[1]?.body));
    expect(openAiBody.model).toBe('gpt-4.1-nano');
  });
});
