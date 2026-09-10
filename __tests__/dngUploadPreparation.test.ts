import { beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { prepareImageForUpload } from '@/server/uploadPreparation';
import { toVisionImage } from '@/server/rasterForVision';

const { convertDngToPngMock } = vi.hoisted(() => ({ convertDngToPngMock: vi.fn() }));
vi.mock('@/server/dngConversion', () => ({ convertDngToPng: convertDngToPngMock }));

describe('DNG upload preparation', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it.each(['', 'application/octet-stream', 'image/tiff', 'image/x-adobe-dng'])('accepts a DNG reported as %s and preserves its dimensions', async (fileType) => {
    const png = await sharp({ create: { width: 80, height: 60, channels: 3, background: '#994422' } }).png().toBuffer();
    convertDngToPngMock.mockResolvedValue(png);
    const result = await prepareImageForUpload({ buffer: Buffer.from('raw'), fileName: 'Camera.DNG', fileType });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({ fileName: 'Camera.png', fileType: 'image/png', buffer: png, transformed: true, bytesBefore: 3 });
    expect(result.data.uploadNormalization).toMatchObject({
      reasons: ['format-conversion'], originalFilename: 'Camera.DNG', originalType: 'image/x-adobe-dng',
      originalWidth: 80, originalHeight: 60, finalWidth: 80, finalHeight: 60, originalBytes: 3, finalBytes: png.length,
    });
  });

  it('normalizes the converted PNG when it exceeds Cloudflare dimensions', async () => {
    const png = await sharp({ create: { width: 12001, height: 2, channels: 3, background: '#447799' } }).png().toBuffer();
    convertDngToPngMock.mockResolvedValue(png);
    const result = await prepareImageForUpload({ buffer: Buffer.from('raw'), fileName: 'wide.dng', fileType: '' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(['image/webp', 'image/jpeg']).toContain(result.data.fileType);
    expect(result.data.fileName).toBe(result.data.fileType === 'image/webp' ? 'wide.webp' : 'wide.jpg');
    expect(result.data.uploadNormalization?.reasons).toContain('max-dimension');
    expect(result.data.uploadNormalization?.reasons).toContain('format-conversion');
    expect(result.data.uploadNormalization?.finalWidth).toBeLessThanOrEqual(12000);
    expect(result.data.uploadNormalization?.originalBytes).toBe(3);
  });

  it('returns a conversion error without attempting an upload', async () => {
    convertDngToPngMock.mockRejectedValue(new Error('DNG conversion failed'));
    expect(await prepareImageForUpload({ buffer: Buffer.from('bad'), fileName: 'bad.dng', fileType: '' }))
      .toEqual({ ok: false, error: 'DNG conversion failed' });
  });

  it('decodes DNGs before pre-upload name and tag suggestions', async () => {
    const png = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#226688' } }).png().toBuffer();
    convertDngToPngMock.mockResolvedValue(png);
    const result = await toVisionImage(Buffer.from('raw'), 'application/octet-stream', 'Camera.DNG');
    expect(result.mime).toBe('image/webp');
    expect(result.rasterized).toBe(true);
    expect(await sharp(result.buffer).metadata()).toMatchObject({ format: 'webp', width: 1024, height: 683 });
  });
});
