import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

import {
  decodeToRaster,
  renderStill,
  renderAnimated,
  resolveGrainradMaxDim,
} from '@/server/image-tools/grainradEngine';
import type { ImageToolRequest } from '@/server/image-tools/types';
import { createTestImageFixture } from './helpers/imageFixtures';

const stillRequest = (overrides: Partial<ImageToolRequest> = {}): ImageToolRequest => ({
  effectId: 'threshold',
  params: { threshold: 120 },
  output: { mode: 'still', format: 'png', preset: 'balanced' },
  timeline: { durationMs: 500, fps: 8, loop: true },
  renderContext: { seed: 1 },
  ...overrides,
});

const createVerticalGradientPng = async (width: number, height: number) => {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const value = y * 24;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }

  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
};

describe('grainradEngine (in-process bridge)', () => {
  it('decodes a WebP source via sharp (the previously-failing ffmpeg case)', async () => {
    const webp = await createTestImageFixture('webp');
    const raster = await decodeToRaster(webp.buffer);
    expect(raster.width).toBe(96);
    expect(raster.height).toBe(72);
    expect(raster.data.length).toBe(96 * 72 * 4);
  });

  it('renders a WebP source to a PNG still without ffmpeg', async () => {
    const webp = await createTestImageFixture('webp');
    const artifact = await renderStill(webp.buffer, stillRequest());
    expect(artifact.contentType).toBe('image/png');
    expect(artifact.filename).toBe('grainrad-threshold.png');
    const meta = await sharp(artifact.buffer).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(96);
    expect(meta.height).toBe(72);
  });

  it('supports png/webp/jpg still outputs', async () => {
    const png = await createTestImageFixture('png');
    for (const [format, expected] of [
      ['png', 'image/png'],
      ['webp', 'image/webp'],
      ['jpg', 'image/jpeg'],
    ] as const) {
      const artifact = await renderStill(png.buffer, stillRequest({
        output: { mode: 'still', format, preset: 'balanced' },
      }));
      expect(artifact.contentType).toBe(expected);
      const meta = await sharp(artifact.buffer).metadata();
      expect(meta.width).toBe(96);
    }
  });

  it('runs the dithering and vhs effects on a still', async () => {
    const png = await createTestImageFixture('png');
    for (const effectId of ['dithering', 'vhs'] as const) {
      const artifact = await renderStill(png.buffer, stillRequest({
        effectId,
        params: effectId === 'dithering' ? { mode: 'bayer4x4' } : { noiseAmount: 0.3, scanlineIntensity: 0.3 },
      }));
      const meta = await sharp(artifact.buffer).metadata();
      expect(meta.width).toBe(96);
      expect(meta.height).toBe(72);
    }
  });

  it('passes paramPreset through to the Grainrad engine', async () => {
    const png = await createTestImageFixture('png');
    await expect(renderStill(png.buffer, stillRequest({
      effectId: 'rgb-subpixel-display',
      paramPreset: 'missing-preset',
      params: {},
    }))).rejects.toThrow(/Unknown paramPreset/i);
  });

  it('lets vertical hold roll independently when the visible band is disabled', async () => {
    const width = 4;
    const height = 8;
    const png = await createVerticalGradientPng(width, height);
    const artifact = await renderStill(png, stillRequest({
      effectId: 'rgb-subpixel-display',
      params: {
        brightness: 0,
        contrast: 0,
        gamma: 1,
        signalResolution: 1,
        resampleMode: 'nearest',
        pixelGlow: 0,
        subpixelGlow: 0,
        phosphorBloom: 0,
        glassBloom: 0,
        maskStrength: 0,
        maskOpacity: 0,
        scanlineIntensity: 0,
        waveAmount: 0,
        verticalHoldAmount: 0,
        verticalHoldSpeed: 0,
        verticalHoldPhase: 0.5,
        verticalHoldRollAmount: 1,
        verticalHoldBandHeight: 0,
        verticalHoldDataDensity: 0,
        verticalHoldDataBrightness: 0,
        horizontalSkewAmount: 0,
        diagonalTearAmount: 0,
      },
      output: { mode: 'still', format: 'png', preset: 'preview' },
    }));
    const decoded = await sharp(artifact.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

    expect(decoded.info.width).toBe(width);
    expect(decoded.info.height).toBe(height);
    expect(decoded.data[0]).toBe(96);
  });

  it('downscales large sources for the preview preset', async () => {
    const big = await sharp({
      create: { width: 1600, height: 1200, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } },
    }).png().toBuffer();
    const artifact = await renderStill(big, stillRequest({
      output: { mode: 'still', format: 'png', preset: 'preview' },
    }));
    const meta = await sharp(artifact.buffer).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(768);
  });

  it('keeps CPU-heavy RGB display exports bounded on heavier presets', () => {
    expect(resolveGrainradMaxDim(stillRequest({
      effectId: 'rgb-subpixel-display',
      paramPreset: 'diagonal-tear-hold-soft-wave-medium',
      params: { verticalHoldAmount: 1, verticalHoldSpeed: 0.3 },
      output: { mode: 'still', format: 'png', preset: 'balanced' },
    }))).toBe(1024);
    expect(resolveGrainradMaxDim(stillRequest({
      effectId: 'rgb-subpixel-display',
      output: { mode: 'still', format: 'png', preset: 'high-quality' },
    }))).toBe(1600);
    expect(resolveGrainradMaxDim(stillRequest({
      effectId: 'threshold',
      output: { mode: 'still', format: 'png', preset: 'high-quality' },
    }))).toBeUndefined();
  });

  it('uses smaller caps for animated RGB display renders', () => {
    expect(resolveGrainradMaxDim(stillRequest({
      effectId: 'rgb-subpixel-display',
      output: { mode: 'animated', format: 'webp', preset: 'preview' },
    }))).toBe(256);
    expect(resolveGrainradMaxDim(stillRequest({
      effectId: 'rgb-subpixel-display',
      output: { mode: 'animated', format: 'webp', preset: 'balanced' },
    }))).toBe(384);
    expect(resolveGrainradMaxDim(stillRequest({
      effectId: 'rgb-subpixel-display',
      output: { mode: 'animated', format: 'webp', preset: 'high-quality' },
    }))).toBe(512);
  });

  it('renders an animated GIF with multiple frames (sharp, no ffmpeg)', async () => {
    const png = await createTestImageFixture('png');
    const artifact = await renderAnimated(png.buffer, stillRequest({
      effectId: 'vhs',
      params: { noiseAmount: 0.4, scanlineIntensity: 0.2 },
      output: { mode: 'animated', format: 'gif', preset: 'preview' },
      timeline: { durationMs: 500, fps: 8, loop: true },
    }));
    expect(artifact.contentType).toBe('image/gif');
    expect(artifact.filename).toBe('grainrad-vhs.gif');
    const meta = await sharp(artifact.buffer, { animated: true }).metadata();
    expect(meta.format).toBe('gif');
    expect(meta.pages ?? 1).toBeGreaterThanOrEqual(2);
  });

  it('renders RGB display animated previews with multiple frames', async () => {
    const png = await createTestImageFixture('png');
    const progress: string[] = [];
    const artifact = await renderAnimated(png.buffer, stillRequest({
      effectId: 'rgb-subpixel-display',
      paramPreset: 'diagonal-tear-hold-soft-wave-medium',
      params: {},
      output: { mode: 'animated', format: 'webp', preset: 'preview' },
      timeline: { durationMs: 400, fps: 4, loop: true },
    }), {
      onProgress: (event) => {
        progress.push(`${event.phase}:${event.message}`);
      },
    });
    expect(artifact.contentType).toBe('image/webp');
    expect(artifact.filename).toBe('grainrad-rgb-subpixel-display.webp');
    const meta = await sharp(artifact.buffer, { animated: true }).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.pages ?? 1).toBeGreaterThanOrEqual(2);
    expect(progress.some((event) => event.includes('Rendering Grainrad frame 1 of 2'))).toBe(true);
    expect(progress.some((event) => event.startsWith('encode:'))).toBe(true);
  });

  it('rejects undecodable source bytes with a clear error', async () => {
    await expect(decodeToRaster(Buffer.from('not-an-image'))).rejects.toThrow(/could not decode/i);
  });
});
