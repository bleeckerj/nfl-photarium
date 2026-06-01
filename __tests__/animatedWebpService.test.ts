import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  buildAnimatedWebpFromFrames,
  reverseAnimatedWebpBuffer,
} from '@/server/animatedWebpService';

const colorFrame = (color: string) =>
  sharp({
    create: {
      width: 4,
      height: 4,
      channels: 4,
      background: color,
    },
  })
    .png()
    .toBuffer();

describe('animatedWebpService', () => {
  it('reverses animated WebP frame order and preserves delays', async () => {
    const frames = await Promise.all([
      colorFrame('#ff0000'),
      colorFrame('#00ff00'),
      colorFrame('#0000ff'),
    ]);
    const animated = await buildAnimatedWebpFromFrames(
      frames.map((buffer) => ({ buffer })),
      { delays: [120, 240, 360], loop: true, quality: 100 }
    );

    const reversed = await reverseAnimatedWebpBuffer(animated.buffer);
    const metadata = await sharp(reversed.buffer, { animated: true }).metadata();
    const raw = await sharp(reversed.buffer, { animated: true }).ensureAlpha().raw().toBuffer();

    expect(reversed.frameCount).toBe(3);
    expect(metadata.pages).toBe(3);
    expect((metadata as sharp.Metadata & { delay?: number[] }).delay).toEqual([360, 240, 120]);

    const firstPixel = raw.subarray(0, 4);
    expect(firstPixel[2]).toBeGreaterThan(firstPixel[0]);
    expect(firstPixel[2]).toBeGreaterThan(firstPixel[1]);
  });
});
