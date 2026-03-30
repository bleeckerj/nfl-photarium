import { describe, expect, it } from 'vitest';
import type { UploaderQueueItem } from '@/features/page-import/types';
import {
  setAllQueuedItemsSelected,
  unselectAttemptedQueuedItems,
} from '@/features/page-import/utils/queueSelection';

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
});
