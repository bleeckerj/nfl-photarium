import { describe, expect, it } from 'vitest';
import { extractFilenameFromUrl, sanitizeFilename } from '@/utils/filename';

describe('filename utils', () => {
  it('extracts filename from Comfy-style query blobs', () => {
    expect(
      extractFilenameFromUrl(
        'http://192.168.15.54:8188/view?filename=futuristic_of.png&type=output&subfolder=2026-02-20',
        'image/png'
      )
    ).toBe('futuristic_of.png');
  });

  it('sanitizes transport query-blob pseudo names to real filenames', () => {
    expect(
      sanitizeFilename('view_filename=futuristic_of.png&type=output&subfolder=2026-02-20')
    ).toBe('futuristic_of.png');
  });

  it('falls back to UploadedImage with preferred extension for non-file URLs', () => {
    expect(
      extractFilenameFromUrl('http://example.com/view', 'image/webp')
    ).toBe('UploadedImage.webp');
  });
});
