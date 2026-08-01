import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

import {
  computeOutpaintCanvas,
  computeWidthPreservingCrop,
  cropImageToWebp,
  buildOutpaintPrompt,
  outpaintImageToWebp,
  prepareOutpaintEditImage,
} from '../src/server/cropVariantService';

async function createStillFixture() {
  return sharp({
    create: {
      width: 120,
      height: 180,
      channels: 4,
      background: '#3456aa',
    },
  })
    .png()
    .toBuffer();
}

async function createAnimatedFixture() {
  const frameWidth = 12;
  const frameHeight = 18;
  const frames = await Promise.all(
    ['#f43f5e', '#22c55e', '#3b82f6'].map((background) =>
      sharp({
        create: {
          width: frameWidth,
          height: frameHeight,
          channels: 4,
          background,
        },
      })
        .raw()
        .toBuffer()
    )
  );

  return sharp(Buffer.concat(frames), {
    raw: {
      width: frameWidth,
      height: frameHeight * frames.length,
      channels: 4,
      pageHeight: frameHeight,
    },
  })
    .webp({ delay: [90, 120, 150], loop: 0, quality: 100, effort: 1 })
    .toBuffer();
}

describe('cropVariantService', () => {
  it('computes full-width crop geometry for supported ratios and anchors', () => {
    expect(computeWidthPreservingCrop({
      sourceWidth: 120,
      sourceHeight: 180,
      aspectRatio: '1:1',
      anchor: 'center',
    })).toMatchObject({ width: 120, height: 120, x: 0, y: 30 });

    expect(computeWidthPreservingCrop({
      sourceWidth: 120,
      sourceHeight: 180,
      aspectRatio: '3:2',
      anchor: 'top',
    })).toMatchObject({ width: 120, height: 80, x: 0, y: 0 });

    expect(computeWidthPreservingCrop({
      sourceWidth: 120,
      sourceHeight: 180,
      aspectRatio: '5:4',
      anchor: 'bottom',
    })).toMatchObject({ width: 120, height: 96, x: 0, y: 84 });

    expect(() =>
      computeWidthPreservingCrop({
        sourceWidth: 120,
        sourceHeight: 120,
        aspectRatio: '4:5',
        anchor: 'bottom',
      })
    ).toThrow(/needs 150px height/i);
  });

  it('creates a still WebP crop with the requested dimensions', async () => {
    const buffer = await createStillFixture();
    const result = await cropImageToWebp({
      buffer,
      aspectRatio: '1:1',
      anchor: 'center',
      quality: 90,
    });

    const metadata = await sharp(result.buffer).metadata();
    expect(metadata.format).toBe('webp');
    expect(metadata.width).toBe(120);
    expect(metadata.height).toBe(120);
    expect(result.crop).toMatchObject({ width: 120, height: 120, y: 30 });
  });

  it('creates an animated WebP crop while preserving frame delays', async () => {
    const buffer = await createAnimatedFixture();
    const result = await cropImageToWebp({
      buffer,
      aspectRatio: '1:1',
      anchor: 'center',
      quality: 90,
    });

    const metadata = await sharp(result.buffer, { animated: true }).metadata();
    expect(metadata.format).toBe('webp');
    expect(metadata.width).toBe(12);
    expect(metadata.pageHeight).toBe(12);
    expect(metadata.pages).toBe(3);
    expect(metadata.delay).toEqual([90, 120, 150]);
    expect(result.animated).toEqual({ frameCount: 3, delaysPreserved: true });
  });

  it('computes a wider outpaint canvas for 4:5 sources expanded to 1:1', () => {
    expect(computeOutpaintCanvas({
      sourceWidth: 1024,
      sourceHeight: 1280,
      aspectRatio: '1:1',
      placement: 'center',
    })).toMatchObject({
      sourceWidth: 1024,
      sourceHeight: 1280,
      targetWidth: 1280,
      targetHeight: 1280,
      x: 128,
      y: 0,
      padding: {
        left: 128,
        right: 128,
        top: 0,
        bottom: 0,
      },
    });
  });

  it('computes a taller outpaint canvas for 1:1 sources expanded to 4:5', () => {
    expect(computeOutpaintCanvas({
      sourceWidth: 1024,
      sourceHeight: 1024,
      aspectRatio: '4:5',
      placement: 'bottom',
    })).toMatchObject({
      sourceWidth: 1024,
      sourceHeight: 1024,
      targetWidth: 1024,
      targetHeight: 1280,
      x: 0,
      y: 256,
      padding: {
        left: 0,
        right: 0,
        top: 256,
        bottom: 0,
      },
    });
  });

  it('creates an outpaint mask that protects the source and exposes only added canvas', async () => {
    const buffer = await sharp({
      create: {
        width: 1024,
        height: 1280,
        channels: 4,
        background: '#0ea5e9',
      },
    })
      .png()
      .toBuffer();

    const prepared = await prepareOutpaintEditImage({
      buffer,
      aspectRatio: '1:1',
      placement: 'center',
    });
    const maskPixel = await sharp(prepared.maskPng).ensureAlpha().raw().toBuffer();
    const canvasWidth = prepared.canvas.targetWidth;
    const leftCanvasAlpha = maskPixel[(10 * canvasWidth + 10) * 4 + 3];
    const sourceAlpha = maskPixel[(10 * canvasWidth + prepared.canvas.x + 10) * 4 + 3];

    expect(prepared.canvas).toMatchObject({ targetWidth: 1280, targetHeight: 1280, x: 128, y: 0 });
    expect(leftCanvasAlpha).toBe(0);
    expect(sourceAlpha).toBe(255);
  });

  it('keeps the main subject dominant in the OpenAI expansion prompt', () => {
    const prompt = buildOutpaintPrompt({
      sourceWidth: 1024,
      sourceHeight: 1280,
      targetWidth: 1280,
      targetHeight: 1280,
      aspectRatio: '1:1',
      placement: 'center',
      x: 128,
      y: 0,
      padding: { top: 0, right: 128, bottom: 0, left: 128 },
    });

    expect(prompt).toContain('Keep the main subject dominant');
    expect(prompt).toContain('reasonable close-to-camera presence');
    expect(prompt).toContain('prevents that diminishment');
  });

  it('requires an OpenAI API key for outpaint generation', async () => {
    const previousKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const buffer = await sharp({
      create: {
        width: 1024,
        height: 1280,
        channels: 4,
        background: '#f97316',
      },
    })
      .png()
      .toBuffer();

    await expect(outpaintImageToWebp({
      buffer,
      aspectRatio: '1:1',
      placement: 'center',
    })).rejects.toThrow(/OPENAI_API_KEY is required/i);

    if (previousKey) {
      process.env.OPENAI_API_KEY = previousKey;
    }
  });
});
