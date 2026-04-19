import { describe, expect, it } from 'vitest';
import {
  formatFailureSummary,
  resolveUploadFilename,
} from '@/hooks/variationUploadUtils';

describe('variationUploadUtils', () => {
  it('includes failure reasons in the summary', () => {
    expect(formatFailureSummary([
      { filename: 'weird-name.png', error: 'Upload failed' },
    ])).toBe('weird-name.png (Upload failed)');
  });

  it('truncates long failure lists after two entries', () => {
    expect(formatFailureSummary([
      { filename: 'a.png', error: 'Upload failed' },
      { filename: 'b.png', error: 'Duplicate detected' },
      { filename: 'c.png', error: 'Unsupported type' },
    ])).toBe('a.png (Upload failed), b.png (Duplicate detected) +1 more');
  });

  it('keeps explicit extensions untouched', () => {
    expect(resolveUploadFilename('custom.webp', 'fallback.png')).toBe('custom.webp');
  });

  it('appends the fallback extension when needed', () => {
    expect(resolveUploadFilename('custom-name', 'https://cdn.example.com/asset.jpg')).toBe('custom-name.jpg');
  });
});
