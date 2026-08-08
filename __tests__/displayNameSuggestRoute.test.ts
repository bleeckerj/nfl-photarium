import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/display-name/suggest/route';

const ORIGINAL_ENV = { ...process.env };

const createRequest = (formData: FormData) =>
  new NextRequest(
    new Request('http://localhost/api/display-name/suggest', {
      method: 'POST',
      body: formData,
    })
  );

describe('POST /api/display-name/suggest', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
    process.env.OPENAI_API_KEY = 'openai-key';
    delete process.env.OPENAI_DISPLAY_NAME_MODEL;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('recovers separate tags from a hyphen-collapsed fallback response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: 'apple-logo-rainbow-colors-fruit-technology-vintage',
              },
            },
          ],
        }),
        { status: 200 }
      )
    );

    const formData = new FormData();
    formData.append('file', new File(['image-bytes'], 'logo.png', { type: 'image/png' }));
    formData.append('includeTags', 'true');
    formData.append('skipDisplayName', 'true');
    formData.append('tagCount', '6');

    const response = await POST(createRequest(formData));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.tags).toEqual(['apple', 'logo', 'rainbow', 'colors', 'fruit', 'technology']);
    expect(payload.model).toBe('gpt-4.1-nano');
  });

  it('prompts the model for the requested tag count instead of the legacy 4-tag range', async () => {
    let promptText = '';

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      promptText = body.messages?.[1]?.content?.[0]?.text ?? '';
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '{"tags":["one","two","three","four","five","six"]}',
              },
            },
          ],
        }),
        { status: 200 }
      );
    });

    const formData = new FormData();
    formData.append('file', new File(['image-bytes'], 'logo.png', { type: 'image/png' }));
    formData.append('includeTags', 'true');
    formData.append('skipDisplayName', 'true');
    formData.append('tagCount', '6');

    const response = await POST(createRequest(formData));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(promptText).toContain('Provide exactly 6 concise semantic tags.');
    expect(promptText).toContain('Return exactly this shape: {"tags":["tag1","tag2","tag3","tag4","tag5","tag6"]}');
    expect(payload.tags).toEqual(['one', 'two', 'three', 'four', 'five', 'six']);
  });

  it('normalizes generated hyphenated phrases before returning them to the uploader', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"tags":["repair-manual","home-server"]}' } }],
        }),
        { status: 200 }
      )
    );

    const formData = new FormData();
    formData.append('file', new File(['image-bytes'], 'manual.png', { type: 'image/png' }));
    formData.append('includeTags', 'true');
    formData.append('skipDisplayName', 'true');
    formData.append('tagCount', '2');

    const response = await POST(createRequest(formData));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.tags).toEqual(['repair manual', 'home server']);
  });

  it('uses OPENAI_DISPLAY_NAME_MODEL when provided', async () => {
    process.env.OPENAI_DISPLAY_NAME_MODEL = 'gpt-5-mini';

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: 'ocean cliffs',
              },
            },
          ],
        }),
        { status: 200 }
      )
    );

    const formData = new FormData();
    formData.append('file', new File(['image-bytes'], 'ocean.png', { type: 'image/png' }));

    const response = await POST(createRequest(formData));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.displayName).toBe('OceanCliffs');
    expect(payload.model).toBe('gpt-5-mini');
  });
});
