import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  isSvgFilename,
  isSvgMime,
  toVisionDataUrl,
  toVisionImage,
  VisionRasterError,
} from '@/server/rasterForVision';

const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="633" height="47" viewBox="0 0 633 47">' +
    '<rect width="633" height="47" fill="#FF2D55"/></svg>',
  'utf8'
);

const makePng = async () =>
  await sharp({
    create: { width: 8, height: 8, channels: 3, background: '#00ff00' },
  })
    .png()
    .toBuffer();

describe('isSvgMime / isSvgFilename', () => {
  it('detects svg mime with and without parameters', () => {
    expect(isSvgMime('image/svg+xml')).toBe(true);
    expect(isSvgMime('image/svg+xml; charset=utf-8')).toBe(true);
    expect(isSvgMime('IMAGE/SVG+XML')).toBe(true);
    expect(isSvgMime('image/webp')).toBe(false);
    expect(isSvgMime(undefined)).toBe(false);
  });

  it('detects svg filenames case-insensitively', () => {
    expect(isSvgFilename('logo.SVG')).toBe(true);
    expect(isSvgFilename('logo.webp')).toBe(false);
    expect(isSvgFilename(null)).toBe(false);
  });
});

describe('toVisionImage', () => {
  it('rasterizes SVG to webp', async () => {
    const result = await toVisionImage(SVG, 'image/svg+xml', 'logo.svg');
    expect(result.rasterized).toBe(true);
    expect(result.mime).toBe('image/webp');

    const metadata = await sharp(result.buffer).metadata();
    expect(metadata.format).toBe('webp');
    expect(metadata.width).toBe(633);
    expect(metadata.height).toBe(47);
  });

  it('rasterizes SVG identified only by filename', async () => {
    const result = await toVisionImage(SVG, undefined, 'logo.svg');
    expect(result.rasterized).toBe(true);
    expect(result.mime).toBe('image/webp');
  });

  it('passes raster input through untouched', async () => {
    const png = await makePng();
    const result = await toVisionImage(png, 'image/png', 'dot.png');
    expect(result.rasterized).toBe(false);
    expect(result.mime).toBe('image/png');
    expect(result.buffer).toBe(png);
  });

  it('sanitizes before rasterizing, dropping script content', async () => {
    const hostile = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">' +
        '<script>alert(1)</script><rect width="10" height="10" fill="#000"/></svg>',
      'utf8'
    );
    const result = await toVisionImage(hostile, 'image/svg+xml', 'x.svg');
    expect(result.rasterized).toBe(true);
    expect(result.buffer.toString('latin1')).not.toContain('alert(1)');
  });

  it('raises VisionRasterError for input that is not a parseable SVG', async () => {
    await expect(
      toVisionImage(Buffer.from('not an svg at all', 'utf8'), 'image/svg+xml', 'x.svg')
    ).rejects.toBeInstanceOf(VisionRasterError);
  });
});

describe('toVisionDataUrl', () => {
  it('never emits an image/svg+xml data URI', async () => {
    const dataUrl = await toVisionDataUrl(SVG, 'image/svg+xml', 'logo.svg');
    expect(dataUrl.startsWith('data:image/webp;base64,')).toBe(true);
    expect(dataUrl).not.toContain('svg+xml');
  });
});
