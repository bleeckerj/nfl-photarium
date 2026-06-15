import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { extractColorsFromBuffer, hexToRgb, type RGB } from '@/server/colorExtraction';

const frameWidth = 20;
const frameHeight = 20;

async function createSolidFrame(color: RGB): Promise<Buffer> {
  return sharp({
    create: {
      width: frameWidth,
      height: frameHeight,
      channels: 3,
      background: color,
    },
  })
    .png()
    .toBuffer();
}

async function createAnimatedWebp(colors: RGB[]): Promise<Buffer> {
  const frames = await Promise.all(colors.map(createSolidFrame));
  return sharp(frames, { join: { animated: true } })
    .webp({ delay: colors.map(() => 80), loop: 0, lossless: true })
    .toBuffer();
}

describe('extractColorsFromBuffer', () => {
  it('samples animated WebP frames beyond a blank first frame', async () => {
    const black = { r: 0, g: 0, b: 0 };
    const purple = { r: 172, g: 76, b: 233 };
    const magenta = { r: 216, g: 27, b: 151 };
    const animatedWebp = await createAnimatedWebp([
      black,
      { r: 12, g: 8, b: 14 },
      purple,
      magenta,
      { r: 8, g: 4, b: 10 },
      black,
    ]);

    const colorInfo = await extractColorsFromBuffer(animatedWebp);

    expect(colorInfo).not.toBeNull();
    expect(colorInfo?.averageRgb.r).toBeGreaterThan(150);
    expect(colorInfo?.averageRgb.g).toBeGreaterThan(40);
    expect(colorInfo?.averageRgb.g).toBeLessThan(90);
    expect(colorInfo?.averageRgb.b).toBeGreaterThan(170);

    const firstDominantColor = hexToRgb(colorInfo?.dominantColors[0] ?? '#000000');
    expect(firstDominantColor?.r).toBeGreaterThan(150);
    expect(firstDominantColor?.b).toBeGreaterThan(140);
  });
});
