import { describe, expect, it } from 'vitest';
import { resolveUploadNormalizationDecodeLimit } from '@/server/uploadPreparation';

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
});
