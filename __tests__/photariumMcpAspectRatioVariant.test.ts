import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

import { parseImageAspectRatio } from '../mcp-server/src/runtime/ai/image-generation.js';

const realFetch = global.fetch;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

function imageDownloadResponse(buffer: Buffer, filename: string, contentType: string): Response {
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'content-type': contentType,
      'content-length': String(buffer.byteLength),
      'content-disposition': `inline; filename="${filename}"`,
    },
  });
}

async function createPngFixture(): Promise<Buffer> {
  return sharp({
    create: {
      width: 16,
      height: 20,
      channels: 4,
      background: '#6699cc',
    },
  })
    .png()
    .toBuffer();
}

async function invokeAspectRatioVariant(args: Record<string, unknown>) {
  process.env.PHOTARIUM_BASE_URL = 'http://photarium.test';
  process.env.OPENAI_API_BASE_URL = 'http://openai.test/v1';
  process.env.OPENAI_API_KEY = 'test-key';
  vi.resetModules();
  const { handleRuntimeToolCall } = await import('../mcp-server/src/runtime/index.js');
  return handleRuntimeToolCall('photarium_aspect_ratio_variant', args);
}

describe('photarium_aspect_ratio_variant', () => {
  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.PHOTARIUM_BASE_URL;
    delete process.env.OPENAI_API_BASE_URL;
    delete process.env.OPENAI_API_KEY;
    vi.restoreAllMocks();
  });

  it('normalizes target aspect ratios', () => {
    expect(parseImageAspectRatio('4x5')).toEqual({ label: '4:5', width: 4, height: 5 });
    expect(parseImageAspectRatio('16 / 9')).toEqual({ label: '16:9', width: 16, height: 9 });
    expect(() => parseImageAspectRatio('wide')).toThrow(/Invalid aspectRatio/i);
  });

  it('returns a dry-run OpenAI edit request for a Photarium image source', async () => {
    const result = await invokeAspectRatioVariant({
      imageId: 'source-image',
      aspectRatio: '4x5',
      dryRun: true,
      outputFormat: 'webp',
      namespace: 'test-generated',
      tags: ['mcp', 'aspect-ratio'],
    });
    expect(result.isError).not.toBe(true);
    const payload = JSON.parse(result.content[0]?.text || '{}');

    expect(payload).toMatchObject({
      dryRun: true,
      mode: 'aspect_ratio_variant',
      aspectRatio: '4:5',
      request: {
        endpoint: '/images/edits',
        body: {
          size: '1024x1280',
          output_format: 'webp',
          images: [{ image_url: 'photarium:source-image' }],
        },
      },
      upload: {
        namespace: 'test-generated',
        tags: ['mcp', 'aspect-ratio'],
        parentId: 'source-image',
      },
      requestedSource: { imageId: 'source-image' },
    });
    expect(payload.request.body.prompt).toContain('Change the source image to a 4:5 aspect ratio');
    expect(payload.request.body.prompt).toContain('do not crop, zoom, stretch, squeeze, or distort');
    expect(payload.sources[0]).toMatchObject({ imageId: 'source-image', role: 'composition_reference' });
  });

  it('uploads a generated image as a source-parented variant with inherited metadata', async () => {
    const sourceBuffer = await createPngFixture();
    const generatedBuffer = await createPngFixture();
    let openAiRequest: Record<string, unknown> | undefined;
    let uploadedParentId: FormDataEntryValue | null = null;
    let uploadedNamespace: FormDataEntryValue | null = null;
    let uploadedTags: FormDataEntryValue | null = null;
    let uploadedOriginalUrl: FormDataEntryValue | null = null;
    let uploadedSourceUrl: FormDataEntryValue | null = null;

    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const requestUrl = new URL(url);

      if (requestUrl.hostname === 'photarium.test' && requestUrl.pathname === '/api/images/source-image') {
        return jsonResponse({
          image: {
            id: 'source-image',
            filename: 'poster.png',
            url: 'https://cdn.test/source-image/public',
            originalUrl: 'https://example.com/original-poster.png',
            sourceUrl: 'https://example.com/source-page',
            meta: {
              namespace: 'source-namespace',
              tags: ['source-tag'],
            },
          },
        });
      }

      if (requestUrl.hostname === 'photarium.test' && requestUrl.pathname === '/api/images/source-image/download') {
        expect(requestUrl.searchParams.get('variant')).toBe('original');
        return imageDownloadResponse(sourceBuffer, 'poster.png', 'image/png');
      }

      if (requestUrl.hostname === 'openai.test' && requestUrl.pathname === '/v1/images/edits') {
        expect(init?.method).toBe('POST');
        openAiRequest = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
        return jsonResponse({
          data: [
            {
              b64_json: generatedBuffer.toString('base64'),
              revised_prompt: 'revised prompt',
            },
          ],
        });
      }

      if (requestUrl.hostname === 'photarium.test' && requestUrl.pathname === '/api/upload/external') {
        const form = init?.body as FormData;
        uploadedParentId = form.get('parentId');
        uploadedNamespace = form.get('namespace');
        uploadedTags = form.get('tags');
        uploadedOriginalUrl = form.get('originalUrl');
        uploadedSourceUrl = form.get('sourceUrl');
        const file = form.get('file') as File;
        return jsonResponse({
          id: 'variant-image',
          filename: file.name,
          url: 'https://cdn.test/variant-image/public',
          parentId: uploadedParentId,
        });
      }

      return jsonResponse({ error: `Unhandled fake route: ${requestUrl.href}` }, 404);
    }) as typeof global.fetch;

    const result = await invokeAspectRatioVariant({
      imageId: 'source-image',
      aspectRatio: '4:5',
      outputFormat: 'png',
    });
    expect(result.isError).not.toBe(true);
    const payload = JSON.parse(result.content[0]?.text || '{}');

    expect(payload.imageId).toBe('variant-image');
    expect(payload.aspectRatio).toBe('4:5');
    expect(openAiRequest).toMatchObject({
      model: 'gpt-image-2',
      size: '1024x1280',
      output_format: 'png',
    });
    expect(String(openAiRequest?.prompt || '')).toContain('preserve the complete visible source image');
    expect(uploadedParentId).toBe('source-image');
    expect(uploadedNamespace).toBe('source-namespace');
    expect(uploadedTags).toBe('source-tag');
    expect(uploadedOriginalUrl).toBe('https://example.com/original-poster.png');
    expect(uploadedSourceUrl).toBe('https://example.com/source-page');
  });
});
