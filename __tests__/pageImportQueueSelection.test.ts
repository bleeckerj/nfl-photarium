import { describe, expect, it } from 'vitest';
import type { UploaderQueueItem } from '@/features/page-import/types';
import {
  setAllQueuedItemsSelected,
  unselectAttemptedQueuedItems,
} from '@/features/page-import/utils/queueSelection';
import { toQueueItem } from '@/features/page-import/hooks/usePageImportDiscovery';

const makeItem = (id: string, selected = true): UploaderQueueItem => ({
  id,
  filename: `${id}.jpg`,
  selected,
});

describe('page import queue selection helpers', () => {
  it('unselects every queued item, including items beyond the visible slice', () => {
    const items = Array.from({ length: 300 }, (_, index) =>
      makeItem(`item-${index + 1}`, index % 3 !== 0)
    );

    const next = setAllQueuedItemsSelected(items, false);

    expect(next).toHaveLength(300);
    expect(next.every((item) => item.selected === false)).toBe(true);
  });

  it('keeps already unselected items unselected when bulk unselect runs', () => {
    const items = [makeItem('a', true), makeItem('b', false), makeItem('c', true)];

    const next = setAllQueuedItemsSelected(items, false);

    expect(next.map((item) => item.selected)).toEqual([false, false, false]);
  });

  it('unselects only attempted items after upload completion', () => {
    const items = [makeItem('a', true), makeItem('b', true), makeItem('c', true)];

    const next = unselectAttemptedQueuedItems(items, new Set(['a', 'c']));

    expect(next.map((item) => item.selected)).toEqual([false, true, false]);
  });

  it('starts below-threshold import candidates unselected', () => {
    const item = toQueueItem(
      {
        id: 'candidate-1',
        kind: 'image',
        url: 'https://example.com/spinner.png',
        filename: 'spinner.png',
        isBlobSource: false,
        metadata: {
          status: 'resolved',
          fileSizeBytes: 24000,
        },
        smallAssetReview: {
          thresholdBytes: 50000,
          reason: 'file-size',
        },
      },
      'queue-1',
      'session-1',
      true
    );

    expect(item.selected).toBe(false);
    expect(item.smallAssetReview).toEqual({
      thresholdBytes: 50000,
      reason: 'file-size',
    });
  });
});
