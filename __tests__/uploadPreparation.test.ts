import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { prepareImageForUpload, resolveUploadNormalizationDecodeLimit } from '@/server/uploadPreparation';

describe('uploadPreparation', () => {
  const createNoisyJpeg = async (width: number, height: number) => {
    const raw = Buffer.alloc(width * height * 3);
    for (let index = 0; index < raw.length; index += 1) {
      raw[index] = (index * 17 + Math.floor(index / 3) * 29) % 256;
    }
    return sharp(raw, { raw: { width, height, channels: 3 } })
      .jpeg({ quality: 100, chromaSubsampling: '4:4:4' })
      .toBuffer();
  };

  it('raises the Sharp decode limit for oversized animations that can be normalized safely', () => {
    const twilightBloomDecodedPixels = 1080 * 1350 * 361;

    expect(resolveUploadNormalizationDecodeLimit(twilightBloomDecodedPixels)).toBe(twilightBloomDecodedPixels);
  });

  it('keeps Sharp defaults for ordinary decoded pixel counts', () => {
    expect(resolveUploadNormalizationDecodeLimit(1080 * 1350)).toBeUndefined();
  });

  it('rejects normalization inputs beyond the server safety budget', () => {
    expect(resolveUploadNormalizationDecodeLimit(1_000_000_001)).toBeNull();
  });

  it('canonicalizes image/jpg to image/jpeg before upload', async () => {
    const result = await prepareImageForUpload({
      buffer: Buffer.from('jpeg-bytes'),
      fileName: 'source.jpg',
      fileType: 'image/jpg',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.fileType).toBe('image/jpeg');
    expect(result.data.fileName).toBe('source.jpg');
    expect(result.data.transformed).toBe(false);
  });

  it('transcodes AVIF sources to a Cloudflare-compatible image type', async () => {
    const buffer = await sharp({
      create: {
        width: 32,
        height: 24,
        channels: 4,
        background: { r: 42, g: 108, b: 156, alpha: 1 },
      },
    })
      .avif({ quality: 70 })
      .toBuffer();

    const result = await prepareImageForUpload({
      buffer,
      fileName: 'source.avif',
      fileType: 'image/avif',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(['image/webp', 'image/jpeg']).toContain(result.data.fileType);
    expect(result.data.fileName).not.toBe('source.avif');
    expect(result.data.transformed).toBe(true);
    expect(result.data.note).toContain('Cloudflare upload compatibility');
  });

  it('keeps dimensions while reducing byte-only oversized JPEGs', async () => {
    const source = await createNoisyJpeg(640, 480);
    const maxBytes = Math.max(1, source.byteLength - 1);
    const result = await prepareImageForUpload({
      buffer: source,
      fileName: 'noisy.jpg',
      fileType: 'image/jpeg',
      maxBytes,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const output = await sharp(result.data.buffer).metadata();
    expect(result.data.bytesAfter).toBeLessThanOrEqual(maxBytes);
    expect(output.width).toBe(640);
    expect(output.height).toBe(480);
    expect(result.data.note).toMatch(/at 640x480 \(q\d+\)/);
    expect(result.data.uploadNormalization?.reasons).toContain('max-bytes');
  });
});
