import { describe, expect, it } from 'vitest';
import type { UploaderQueueItem } from '@/features/page-import/types';
import {
  applyMetadataPatchToQueuedItem,
  type MetadataPatch,
} from '@/features/page-import/hooks/usePageImportSession';

describe('page import session queue metadata patches', () => {
  it('removes stale small-asset review and reselects the item when resolved metadata is above threshold', () => {
    const item: UploaderQueueItem = {
      id: 'queue-1',
      assetType: 'image',
      filename: 'flowerbg-2.png',
      remoteUrl: 'https://cdn.shopify.com/flowerbg-2.png',
      selected: false,
      sizeBytes: 24000,
      smallAssetReview: {
        thresholdBytes: 50000,
        reason: 'file-size',
      },
      metadata: {
        status: 'partial',
        fileSizeBytes: 24000,
      },
    };
    const patch: MetadataPatch = {
      id: 'queue-1',
      url: 'https://cdn.shopify.com/flowerbg-2.png',
      metadata: {
        status: 'resolved',
        fileSizeBytes: 130000,
        dimensions: { width: 300, height: 225 },
        contentType: 'image/png',
      },
    };

    const next = applyMetadataPatchToQueuedItem(item, patch);

    expect(next.smallAssetReview).toBeUndefined();
    expect(next.selected).toBe(true);
    expect(next.sizeBytes).toBe(130000);
    expect(next.contentType).toBe('image/png');
  });
});
