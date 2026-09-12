import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  generatePhotariumImage,
  generatePhotariumImageFromReferences,
} from '../mcp-server/src/runtime/ai/image-generation.js';

const originalApiKey = process.env.OPENAI_API_KEY;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalApiKey) process.env.OPENAI_API_KEY = originalApiKey;
  else delete process.env.OPENAI_API_KEY;
});

describe('Photarium OpenAI image generation', () => {
  it('defaults to Sunburst and auto quality', async () => {
    const result = await generatePhotariumImage(
      {
        downloadOriginalImageById: vi.fn(),
        uploadFileBase64: vi.fn(),
      },
      { prompt: 'A translucent orange alarm clock', dryRun: true },
    );

    expect(result).toMatchObject({
      request: {
        body: {
          model: 'gpt-image-2.5-sunburst',
          quality: 'auto',
        },
      },
    });
  });

  it('rejects unsupported model, quality, and dimensions before making a request', async () => {
    const deps = {
      downloadOriginalImageById: vi.fn(),
      uploadFileBase64: vi.fn(),
    };

    await expect(generatePhotariumImage(deps, { prompt: 'test', model: 'unlisted-image-model', dryRun: true }))
      .rejects.toThrow('Unsupported OpenAI image model');
    await expect(generatePhotariumImage(deps, { prompt: 'test', quality: 'ultra', dryRun: true }))
      .rejects.toThrow('Unsupported OpenAI image quality');
    await expect(generatePhotariumImage(deps, { prompt: 'test', size: '1025x1024', dryRun: true }))
      .rejects.toThrow('multiples of 16');
    await expect(generatePhotariumImage(deps, { prompt: 'test', model: 'gpt-image-2', quality: 'max', dryRun: true }))
      .rejects.toThrow('does not support max quality');
  });

  it('sends source edits as multipart image files', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith('data:image/png;base64,')) {
        return new Response(Buffer.from('source-image'), { status: 200, headers: { 'content-type': 'image/png' } });
      }
      expect(String(input)).toBe('https://api.openai.com/v1/images/edits');
      expect(init?.body).toBeInstanceOf(FormData);
      const form = init?.body as FormData;
      expect(form.get('model')).toBe('gpt-image-2.5-flare');
      expect(form.get('quality')).toBe('max');
      expect(form.getAll('image[]')).toHaveLength(1);
      expect(form.get('image[]')).toBeInstanceOf(Blob);
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('generated-image').toString('base64') }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const uploadFileBase64 = vi.fn(async () => ({ id: 'child-1', url: 'https://example.test/child-1' }));

    const result = await generatePhotariumImageFromReferences(
      {
        downloadOriginalImageById: vi.fn(async () => ({
          base64: Buffer.from('source-image').toString('base64'),
          contentType: 'image/png',
          filename: 'source.png',
          variantUsed: 'original',
          fallbackUsed: false,
        })),
        uploadFileBase64,
      },
      {
        prompt: 'Keep the composition and replace only the chair.',
        model: 'gpt-image-2.5-flare',
        quality: 'max',
      },
      [{ imageId: 'source-1', role: 'subject_reference' }],
      'direct_prompt',
    );

    expect(result).toMatchObject({ imageId: 'child-1', model: 'gpt-image-2.5-flare' });
    expect(uploadFileBase64).toHaveBeenCalledOnce();
  });
});
