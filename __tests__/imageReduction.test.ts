import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  reduceImageFileToLimit,
  shouldDelegateImageReductionToServer,
} from '@/components/image-uploader/fileHelpers';

const MAX_BYTES = 10 * 1024 * 1024;

type MockCanvas = {
  width: number;
  height: number;
  getContext: () => { drawImage: ReturnType<typeof vi.fn> };
  toBlob: (callback: BlobCallback, type?: string, quality?: number) => void;
};

const installCanvasMocks = ({ sourceWidth, sourceHeight, baseBytes }: {
  sourceWidth: number;
  sourceHeight: number;
  baseBytes: number;
}) => {
  const formats: string[] = [];
  const canvases: MockCanvas[] = [];
  const canvasFactory = vi.fn(() => {
    const canvas: MockCanvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: vi.fn() }),
      toBlob: (callback, type = 'image/png', quality = 1) => {
        formats.push(type);
        const scale = (canvas.width * canvas.height) / (sourceWidth * sourceHeight);
        const formatMultiplier = type === 'image/jpeg' ? 1 : 1.1;
        const size = Math.round(baseBytes * formatMultiplier * scale * (0.75 + quality * 0.25));
        callback({ size, type } as Blob);
      },
    };
    canvases.push(canvas);
    return canvas;
  });

  vi.stubGlobal('document', { createElement: canvasFactory });
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
    width: sourceWidth,
    height: sourceHeight,
    close: vi.fn(),
  })));

  return { formats, canvases };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('image reduction', () => {
  it('delegates animated and raw formats to server normalization', () => {
    expect(shouldDelegateImageReductionToServer(new File(['raw'], 'camera.dng', { type: 'image/x-adobe-dng' }))).toBe(true);
    expect(shouldDelegateImageReductionToServer(new File(['gif'], 'motion.gif', { type: 'image/gif' }))).toBe(true);
    expect(shouldDelegateImageReductionToServer(new File(['webp'], 'motion.webp', { type: 'image/webp' }))).toBe(true);
    expect(shouldDelegateImageReductionToServer(new File(['jpeg'], 'photo.jpg', { type: 'image/jpeg' }))).toBe(false);
  });

  describe('browser encoding policy', () => {
    beforeEach(() => {
      installCanvasMocks({ sourceWidth: 1200, sourceHeight: 800, baseBytes: 11_000_000 });
    });

    it('keeps dimensions and uses a high-quality result close to the limit', async () => {
      const reduced = await reduceImageFileToLimit(
        new File(['source'], 'photo.jpg', { type: 'image/jpeg' }),
        MAX_BYTES,
      );

      expect(reduced).not.toBeNull();
      expect(reduced).toMatchObject({ width: 1200, height: 800, type: 'image/jpeg' });
      expect(reduced?.blob.size).toBeLessThanOrEqual(MAX_BYTES);
      expect(reduced?.blob.size).toBeGreaterThan(9 * 1024 * 1024);
      expect(reduced?.note).toMatch(/q\d+ at 1200x800$/);
    });

    it('uses WebP for PNG sources so the reducer cannot flatten transparency to JPEG', async () => {
      const { formats } = installCanvasMocks({ sourceWidth: 1200, sourceHeight: 800, baseBytes: 11_000_000 });
      const reduced = await reduceImageFileToLimit(
        new File(['source'], 'transparent.png', { type: 'image/png' }),
        MAX_BYTES,
      );

      expect(reduced?.type).toBe('image/webp');
      expect(formats).not.toContain('image/jpeg');
    });
  });

  it('finds the largest passing dimensions only after full-size quality fails', async () => {
    installCanvasMocks({ sourceWidth: 2000, sourceHeight: 1000, baseBytes: 60_000_000 });
    const reduced = await reduceImageFileToLimit(
      new File(['source'], 'large.jpg', { type: 'image/jpeg' }),
      MAX_BYTES,
    );

    expect(reduced).not.toBeNull();
    expect(reduced?.blob.size).toBeLessThanOrEqual(MAX_BYTES);
    expect(reduced?.width).toBeGreaterThan(700);
    expect(reduced?.width).toBeLessThan(2000);
    expect((reduced?.height ?? 0) / (reduced?.width ?? 1)).toBeCloseTo(0.5, 2);
    expect(reduced?.note).toMatch(/reduced to .* at \d+x\d+$/);
  });
});
