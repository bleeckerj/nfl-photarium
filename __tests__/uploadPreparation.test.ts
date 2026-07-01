import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { prepareImageForUpload, resolveUploadNormalizationDecodeLimit } from '@/server/uploadPreparation';

describe('uploadPreparation', () => {
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
});
