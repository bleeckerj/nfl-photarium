import { describe, expect, it } from 'vitest';
import {
  reconcileSmallAssetReview,
  type SmallAssetReview,
} from '@/features/page-import/utils/smallAssetPolicy';

describe('small asset policy', () => {
  it('clears a file-size review when resolved metadata is above the byte threshold', () => {
    const review: SmallAssetReview = {
      thresholdBytes: 50000,
      reason: 'file-size',
    };

    expect(
      reconcileSmallAssetReview(review, {
        fileSizeBytes: 130000,
        dimensions: { width: 300, height: 225 },
      })
    ).toBeUndefined();
  });

  it('clears a dimension review when resolved dimensions are above the dimension threshold', () => {
    const review: SmallAssetReview = {
      thresholdBytes: 50000,
      reason: 'dimensions',
    };

    expect(
      reconcileSmallAssetReview(review, {
        dimensions: { width: 300, height: 225 },
      })
    ).toBeUndefined();
  });

  it('keeps a review when later metadata still qualifies as small', () => {
    const review: SmallAssetReview = {
      thresholdBytes: 50000,
      reason: 'file-size',
    };

    expect(
      reconcileSmallAssetReview(review, {
        fileSizeBytes: 24000,
        dimensions: { width: 300, height: 225 },
      })
    ).toEqual(review);
  });
});
