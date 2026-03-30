import type { UploaderQueueItem } from '@/features/page-import/types';

export const setAllQueuedItemsSelected = (
  items: UploaderQueueItem[],
  selected: boolean
): UploaderQueueItem[] =>
  items.map((item) => (item.selected === selected ? item : { ...item, selected }));

export const unselectAttemptedQueuedItems = (
  items: UploaderQueueItem[],
  attemptedIds: Set<string>
): UploaderQueueItem[] =>
  items.map((item) =>
    attemptedIds.has(item.id) && item.selected !== false
      ? { ...item, selected: false }
      : item
  );
