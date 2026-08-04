'use client';

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { QUEUE_RENDER_LIMIT } from '@/components/image-uploader/constants';
import {
  setAllQueuedItemsSelected,
  setSmallAssetReviewItemsSelected,
} from '@/features/page-import/utils/queueSelection';
import type { UploaderQueueItem } from '@/features/page-import/types';

type UseQueueViewActionsOptions = {
  queuedFiles: UploaderQueueItem[];
  clearQueue: () => void;
  removeQueuedFile: (id: string) => void;
  unselectAllQueuedFiles: () => void;
  clearReducingQueueItem: (id: string) => void;
  clearReducingQueueItems: () => void;
  setQueuedFiles: Dispatch<SetStateAction<UploaderQueueItem[]>>;
  setPreviewFailures: Dispatch<SetStateAction<Record<string, boolean>>>;
};

const withoutKey = (id: string) => (prev: Record<string, boolean>) => {
  const next = { ...prev };
  delete next[id];
  return next;
};

/**
 * Queue presentation state — which rows are expanded, whether the list is
 * truncated — and the selection and removal actions that have to keep that
 * per-item state in sync as items leave the queue.
 */
export function useQueueViewActions({
  queuedFiles,
  clearQueue,
  removeQueuedFile,
  unselectAllQueuedFiles,
  clearReducingQueueItem,
  clearReducingQueueItems,
  setQueuedFiles,
  setPreviewFailures,
}: UseQueueViewActionsOptions) {
  const [expandedQueueMetadata, setExpandedQueueMetadata] = useState<Record<string, boolean>>({});
  const [showAllQueuedItems, setShowAllQueuedItems] = useState(false);

  useEffect(() => {
    if (queuedFiles.length <= QUEUE_RENDER_LIMIT && showAllQueuedItems) {
      setShowAllQueuedItems(false);
    }
  }, [queuedFiles.length, showAllQueuedItems]);

  const visibleQueuedFiles = useMemo(
    () => (showAllQueuedItems ? queuedFiles : queuedFiles.slice(0, QUEUE_RENDER_LIMIT)),
    [queuedFiles, showAllQueuedItems]
  );

  const handleClearQueuedItems = useCallback(() => {
    clearQueue();
    setPreviewFailures({});
    clearReducingQueueItems();
    setExpandedQueueMetadata({});
    setShowAllQueuedItems(false);
  }, [clearQueue, clearReducingQueueItems, setPreviewFailures]);

  const handleRemoveQueuedItem = useCallback(
    (id: string) => {
      removeQueuedFile(id);
      setPreviewFailures(withoutKey(id));
      clearReducingQueueItem(id);
      setExpandedQueueMetadata(withoutKey(id));
    },
    [clearReducingQueueItem, removeQueuedFile, setPreviewFailures]
  );

  const handleToggleQueueMetadata = useCallback((id: string) => {
    setExpandedQueueMetadata((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const handleSelectAllQueuedItems = useCallback(() => {
    setQueuedFiles((prev) => setAllQueuedItemsSelected(prev, true));
  }, [setQueuedFiles]);

  const handleSelectSmallAssetQueuedItems = useCallback(() => {
    setQueuedFiles((prev) => setSmallAssetReviewItemsSelected(prev, true));
  }, [setQueuedFiles]);

  return {
    expandedQueueMetadata,
    showAllQueuedItems,
    setShowAllQueuedItems,
    visibleQueuedFiles,
    handleClearQueuedItems,
    handleRemoveQueuedItem,
    handleToggleQueueMetadata,
    handleSelectAllQueuedItems,
    handleSelectSmallAssetQueuedItems,
    handleUnselectAllQueuedItems: unselectAllQueuedFiles,
  };
}
