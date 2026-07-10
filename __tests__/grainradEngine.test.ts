import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

import {
  decodeAnimatedSourceToRasters,
  decodeToRaster,
  renderStill,
  renderAnimated,
  resolveGrainradMaxDim,
  sourceFrameIndexAtTime,
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

  it('renders the source-collage effect on a still', async () => {
    const png = await createTestImageFixture('png');
    const artifact = await renderStill(png.buffer, stillRequest({
      effectId: 'source-collage',
      paramPreset: 'instagram-cascade',
      params: {
        tileCount: 18,
        recursionDepth: 4,
        motionAmount: 0,
      },
    }));
    expect(artifact.contentType).toBe('image/png');
    expect(artifact.filename).toBe('grainrad-source-collage.png');
    const meta = await sharp(artifact.buffer).metadata();
    expect(meta.width).toBe(96);
    expect(meta.height).toBe(72);
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

  // Animated source support: a black-then-white 2-frame GIF makes it trivially
  // observable which source frame fed each output frame.
  const createBlackWhiteGif = async (width = 32, height = 24, delayMs = 250) => {
    const black = Buffer.alloc(width * height * 4);
    const white = Buffer.alloc(width * height * 4, 255);
    for (let i = 3; i < black.length; i += 4) black[i] = 255;
    return sharp(Buffer.concat([black, white]), {
      raw: { width, height: height * 2, channels: 4, pageHeight: height },
    }).gif({ delay: [delayMs, delayMs], loop: 0 }).toBuffer();
  };

  const pageLuminances = async (buffer: Buffer) => {
    const meta = await sharp(buffer, { animated: true }).metadata();
    const pages = meta.pages ?? 1;
    const { data, info } = await sharp(buffer, { animated: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const frameHeight = info.height / pages;
    const frameBytes = info.width * frameHeight * 4;
    return Array.from({ length: pages }, (_, page) => {
      let sum = 0;
      let count = 0;
      for (let i = page * frameBytes; i < (page + 1) * frameBytes; i += 4) {
        sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
        count += 1;
      }
      return sum / count;
    });
  };

  it('decodes an animated GIF source into per-frame rasters with delays', async () => {
    const gif = await createBlackWhiteGif(32, 24, 250);
    const source = await decodeAnimatedSourceToRasters(gif);
    expect(source).not.toBeNull();
    expect(source!.frames).toHaveLength(2);
    expect(source!.frames[0].width).toBe(32);
    expect(source!.frames[0].height).toBe(24);
    expect(source!.frameDelaysMs).toEqual([250, 250]);
    expect(source!.totalDurationMs).toBe(500);
    expect(sourceFrameIndexAtTime(source!, 0, true)).toBe(0);
    expect(sourceFrameIndexAtTime(source!, 0.25, true)).toBe(1);
    expect(sourceFrameIndexAtTime(source!, 0.5, true)).toBe(0); // loop wrap
    expect(sourceFrameIndexAtTime(source!, 9, false)).toBe(1); // hold last frame
  });

  it('returns null for single-frame sources so the still path is used', async () => {
    const png = await createTestImageFixture('png');
    expect(await decodeAnimatedSourceToRasters(png.buffer)).toBeNull();
  });

  it('preserves an animated GIF source motion through an animated render', async () => {
    const gif = await createBlackWhiteGif(32, 24, 250);
    const artifact = await renderAnimated(gif, stillRequest({
      effectId: 'threshold',
      params: { threshold: 120 },
      output: { mode: 'animated', format: 'gif', preset: 'preview' },
      timeline: { durationMs: 500, fps: 8, loop: true },
    }));
    expect(artifact.contentType).toBe('image/gif');
    // Output frames at t<0.25s sample the black source frame, later ones the
    // white frame. sharp's GIF encoder merges identical consecutive frames
    // (summing their delays), so assert the black->white sequence and the
    // preserved overall duration rather than an exact page count.
    const luminances = await pageLuminances(artifact.buffer);
    expect(luminances.length).toBeGreaterThanOrEqual(2);
    expect(luminances[0]).toBeLessThan(64);
    expect(luminances[luminances.length - 1]).toBeGreaterThan(192);
    const meta = await sharp(artifact.buffer, { animated: true }).metadata();
    const totalDelayMs = (meta.delay ?? []).reduce((sum, d) => sum + d, 0);
    expect(totalDelayMs).toBeGreaterThanOrEqual(400);
    expect(totalDelayMs).toBeLessThanOrEqual(600);
  });

  it('derives the timeline from the animated source when the request omits it', async () => {
    const gif = await createBlackWhiteGif(32, 24, 250);
    const artifact = await renderAnimated(gif, stillRequest({
      effectId: 'threshold',
      params: { threshold: 120 },
      output: { mode: 'animated', format: 'gif', preset: 'preview' },
      timeline: undefined,
    }));
    // Source cadence: 2 frames x 250ms -> 4fps over 500ms -> 2 output frames.
    const luminances = await pageLuminances(artifact.buffer);
    expect(luminances).toHaveLength(2);
    expect(luminances[0]).toBeLessThan(64);
    expect(luminances[1]).toBeGreaterThan(192);
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

  it('renders source-collage animated previews with multiple frames', async () => {
    const png = await createTestImageFixture('png');
    const artifact = await renderAnimated(png.buffer, stillRequest({
      effectId: 'source-collage',
      paramPreset: 'instagram-cascade',
      params: {
        tileCount: 16,
        recursionDepth: 4,
        stateRate: 4,
      },
      output: { mode: 'animated', format: 'webp', preset: 'preview' },
      timeline: { durationMs: 500, fps: 4, loop: true },
    }));
    expect(artifact.contentType).toBe('image/webp');
    expect(artifact.filename).toBe('grainrad-source-collage.webp');
    const meta = await sharp(artifact.buffer, { animated: true }).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.pages ?? 1).toBeGreaterThanOrEqual(2);
  });

  it('expands vertical hold full-loop animations to one complete roll cycle', async () => {
    const png = await createTestImageFixture('png');
    const progress: string[] = [];
    await renderAnimated(png.buffer, stillRequest({
      effectId: 'vhs',
      params: {
        jitterAmount: 0,
        jitterFrequency: 0,
        jitterSpeed: 0,
        rgbSplit: 0,
        bleed: 0,
        blur: 0,
        scanlineIntensity: 0,
        noiseAmount: 0,
        desaturation: 0,
        brightness: 0,
        contrast: 0,
        verticalHoldAmount: 1,
        verticalHoldSpeed: 1,
        verticalHoldRollAmount: 0.25,
        verticalHoldBandHeight: 0.08,
        verticalHoldSoftness: 0.18,
        verticalHoldDataDensity: 0,
        verticalHoldDataBrightness: 0,
        verticalHoldFullLoop: true,
        horizontalSkewAmount: 0,
        diagonalTearAmount: 0,
      },
      output: { mode: 'animated', format: 'webp', preset: 'preview' },
      timeline: { durationMs: 500, fps: 4, loop: true },
    }), {
      onProgress: (event) => {
        progress.push(event.message);
      },
    });

    expect(progress.some((event) => event.includes('Rendering Grainrad frame 1 of 4'))).toBe(true);
    expect(progress.some((event) => event.includes('Rendered Grainrad frame 4 of 4'))).toBe(true);
  });

  it('rejects undecodable source bytes with a clear error', async () => {
    await expect(decodeToRaster(Buffer.from('not-an-image'))).rejects.toThrow(/could not decode/i);
  });
});
