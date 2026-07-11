import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { buildAnimatedWebpFromFrames } from '@/server/animatedWebpService';
import { normalizeQuarterTurn, rotateImageBuffer } from '@/server/imageRotationService';

const asymmetricFrame = async (color: { r: number; g: number; b: number; alpha: number }) => {
  const pixels = Buffer.alloc(3 * 2 * 4);
  pixels.set([color.r, color.g, color.b, color.alpha], 0);
  return sharp(pixels, { raw: { width: 3, height: 2, channels: 4 } }).png().toBuffer();
};

describe('imageRotationService', () => {
  it('normalizes only non-zero quarter turns', () => {
    expect(normalizeQuarterTurn(90)).toBe(90);
    expect(normalizeQuarterTurn(-90)).toBe(270);
    expect(normalizeQuarterTurn(450)).toBe(90);
    expect(normalizeQuarterTurn(0)).toBeNull();
    expect(normalizeQuarterTurn(45)).toBeNull();
    expect(normalizeQuarterTurn('90')).toBeNull();
  });

  it.each([90, 180, 270] as const)(
    'rotates every animated WebP frame %i degrees and preserves timing',
    async (degrees) => {
      const frames = await Promise.all([
        asymmetricFrame({ r: 255, g: 0, b: 0, alpha: 255 }),
        asymmetricFrame({ r: 0, g: 255, b: 0, alpha: 128 }),
        asymmetricFrame({ r: 0, g: 0, b: 255, alpha: 255 }),
      ]);
      const source = await buildAnimatedWebpFromFrames(
        frames.map((buffer) => ({ buffer })),
        { delays: [110, 220, 330], loop: true, quality: 100 }
      );

      const rotated = await rotateImageBuffer(source.buffer, degrees);
      const metadata = await sharp(rotated.buffer, { animated: true }).metadata();
      const raw = await sharp(rotated.buffer, { animated: true }).ensureAlpha().raw().toBuffer();

      expect(rotated.animated).toBe(true);
      expect(rotated.frameCount).toBe(3);
      expect(metadata.pages).toBe(3);
      expect(metadata.delay).toEqual([110, 220, 330]);
      expect(metadata.loop).toBe(0);
      expect(rotated.width).toBe(degrees === 180 ? 3 : 2);
      expect(rotated.height).toBe(degrees === 180 ? 2 : 3);

      const expectedPixel = degrees === 90
        ? { x: 1, y: 0 }
        : degrees === 180
          ? { x: 2, y: 1 }
          : { x: 0, y: 2 };
      const offset = (expectedPixel.y * rotated.width + expectedPixel.x) * 4;
      expect(raw[offset]).toBeGreaterThan(200);
      expect(raw[offset + 1]).toBeLessThan(40);
      expect(raw[offset + 2]).toBeLessThan(40);
    }
  );

  it('rotates a static image without marking it animated', async () => {
    const source = await asymmetricFrame({ r: 255, g: 0, b: 0, alpha: 255 });
    const rotated = await rotateImageBuffer(source, 90);
    const metadata = await sharp(rotated.buffer).metadata();

    expect(rotated.animated).toBe(false);
    expect(rotated.frameCount).toBe(1);
    expect(metadata.width).toBe(2);
    expect(metadata.height).toBe(3);
  });
});
