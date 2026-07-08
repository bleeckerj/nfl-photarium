import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

import { renderEightBitWorkflowArtifact } from '@/server/image-tools/eightBitWorkflow';
import type { ImageToolRequest } from '@/server/image-tools/types';

const { getCachedImageMock, getPromptThisRecordMock } = vi.hoisted(() => ({
  getCachedImageMock: vi.fn(),
  getPromptThisRecordMock: vi.fn(),
}));

vi.mock('@/server/cloudflareImageCache', () => ({
  getCachedImage: getCachedImageMock,
}));

vi.mock('@/server/promptThis', () => ({
  getPromptThisRecord: getPromptThisRecordMock,
}));

const request = (workflow: ImageToolRequest['workflow']): ImageToolRequest => ({
  effectId: 'eight-bit',
  params: {
    workingWidth: 32,
    paletteSize: 12,
    ditherMode: 'ordered',
    ditherStrength: 0.04,
    outlineStrength: 0.06,
    minSubjectLuminance: 12,
    allowTrueBlack: false,
    upscale: 2,
  },
  output: { mode: 'still', format: 'png', preset: 'preview' },
  renderContext: { seed: 123 },
  workflow,
});

let sourcePng: Buffer;
let generatedPng: Buffer;

describe('renderEightBitWorkflowArtifact', () => {
  beforeAll(async () => {
    sourcePng = await sharp({
      create: {
        width: 48,
        height: 36,
        channels: 4,
        background: { r: 180, g: 80, b: 40, alpha: 1 },
      },
    }).png().toBuffer();
    generatedPng = await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 4,
        background: { r: 40, g: 140, b: 210, alpha: 1 },
      },
    }).png().toBuffer();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.OPENAI_API_KEY;
  });

  it('runs filter mode without calling OpenAI', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    const artifact = await renderEightBitWorkflowArtifact(sourcePng, request({
      mode: 'filter',
      styleStrength: 'classic',
    }), { sourceImageId: 'image-1' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(artifact.contentType).toBe('image/png');
    const meta = await sharp(artifact.buffer).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBeGreaterThan(0);
  });

  it('runs reinterpretation mode through OpenAI before applying the 8-bit pass', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    getPromptThisRecordMock.mockResolvedValue({
      prompt: 'A red product bottle on ice.',
    });
    getCachedImageMock.mockResolvedValue(null);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: generatedPng.toString('base64'), revised_prompt: 'revised' }],
    }), { status: 200 }));

    const artifact = await renderEightBitWorkflowArtifact(sourcePng, request({
      mode: 'reinterpretation',
      styleStrength: 'polished',
      promptHint: 'Keep the label blocky.',
    }), { sourceImageId: 'image-1' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
      prompt: string;
      images: Array<{ image_url: string }>;
    };
    expect(body.prompt).toContain('A red product bottle on ice.');
    expect(body.prompt).toContain('Keep the label blocky.');
    expect(body.images[0].image_url).toMatch(/^data:image\/png;base64,/);
    expect(artifact.contentType).toBe('image/png');
    const meta = await sharp(artifact.buffer).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBeGreaterThan(0);
  });
});
