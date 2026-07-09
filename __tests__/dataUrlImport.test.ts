import { describe, expect, it } from 'vitest';
import { createImageFileFromDataUrl, isDataUrl } from '@/components/image-uploader/dataUrlImport';

describe('data URL import helpers', () => {
  it('creates an image file from a base64 image data URL', async () => {
    const dataUrl = `data:image/webp;base64,${Buffer.from('webp-bytes').toString('base64')}`;

    const file = createImageFileFromDataUrl(dataUrl, 'MusicVortexHole');

    expect(file.name).toBe('MusicVortexHole.webp');
    expect(file.type).toBe('image/webp');
    expect(Buffer.from(await file.arrayBuffer()).toString()).toBe('webp-bytes');
  });

  it('detects data URLs before remote URL import', () => {
    expect(isDataUrl('data:image/png;base64,aaaa')).toBe(true);
    expect(isDataUrl(' https://example.com/image.png ')).toBe(false);
  });

  it('rejects non-image data URLs', () => {
    const textDataUrl = `data:text/plain;base64,${Buffer.from('hello').toString('base64')}`;

    expect(() => createImageFileFromDataUrl(textDataUrl)).toThrow(/base64 image data/i);
  });
});
