import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/images/[id]/display-name/route';

const ORIGINAL_ENV = { ...process.env };

describe('POST /api/images/[id]/display-name', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
    process.env.CLOUDFLARE_ACCOUNT_ID = 'cf-account';
    process.env.CLOUDFLARE_API_TOKEN = 'cf-token';
    process.env.OPENAI_API_KEY = 'openai-key';
    delete process.env.OPENAI_DISPLAY_NAME_MODEL;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('defaults to gpt-4.1-nano when no override is set', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: {
              filename: 'sample.jpg',
              variants: ['https://example.com/sample-public.jpg'],
              meta: { folder: 'instagram', tags: ['sunset'] },
            },
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'sunset sea cliffs' } }],
          }),
          { status: 200 }
        )
      );

    const response = await POST(new Request('http://localhost/api/images/img-1/display-name', { method: 'POST' }), {
      params: Promise.resolve({ id: 'img-1' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.displayName).toBe('SunsetSeaCliffs');
    expect(payload.model).toBe('gpt-4.1-nano');
  });

  it('uses OPENAI_DISPLAY_NAME_MODEL when provided', async () => {
    process.env.OPENAI_DISPLAY_NAME_MODEL = 'gpt-5-mini';

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: {
              filename: 'sample.jpg',
              variants: ['https://example.com/sample-public.jpg'],
              meta: {},
            },
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'sample image' } }],
          }),
          { status: 200 }
        )
      );

    const response = await POST(new Request('http://localhost/api/images/img-2/display-name', { method: 'POST' }), {
      params: Promise.resolve({ id: 'img-2' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.model).toBe('gpt-5-mini');
  });
});
