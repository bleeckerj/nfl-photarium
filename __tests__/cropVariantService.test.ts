import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

import {
  computeWidthPreservingCrop,
  cropImageToWebp,
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
});
