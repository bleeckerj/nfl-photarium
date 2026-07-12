'use client';

import { useEffect, useRef, useState } from 'react';
import type { UploaderQueueItem } from '@/features/page-import/types';
import { runWithConcurrency } from '@/components/image-uploader/concurrency';
import { captureLocalVideoPreview } from '@/components/image-uploader/videoPreview';

const CAPTURE_CONCURRENCY = 2;

const needsLocalVideoPreview = (item: UploaderQueueItem) =>
  item.assetType === 'video' &&
  Boolean(item.file) &&
  !item.posterUrl &&
  item.metadata?.status !== 'failed';

export function useLocalVideoPreviews(params: {
  queuedFiles: UploaderQueueItem[];
  updateQueuedFile: (id: string, updates: Partial<UploaderQueueItem>) => void;
}) {
  const { queuedFiles, updateQueuedFile } = params;
  const [cycle, setCycle] = useState(0);
  const inflight = useRef(new Set<string>());
  const attempted = useRef(new Set<string>());
  const running = useRef(false);
  const queuedIdsRef = useRef(new Set<string>());

  useEffect(() => {
    queuedIdsRef.current = new Set(queuedFiles.map((item) => item.id));
  }, [queuedFiles]);

  useEffect(() => {
    if (running.current) return;
    const targets = queuedFiles.filter(
      (item) =>
        needsLocalVideoPreview(item) &&
        !inflight.current.has(item.id) &&
        !attempted.current.has(item.id)
    );
    if (targets.length === 0) return;

    running.current = true;
    targets.forEach((item) => inflight.current.add(item.id));

    const run = async () => {
      try {
        await runWithConcurrency(targets, CAPTURE_CONCURRENCY, async (item) => {
          const file = item.file;
          if (!file) return;
          attempted.current.add(item.id);
          try {
            const preview = await captureLocalVideoPreview(file);
            if (!queuedIdsRef.current.has(item.id)) {
              preview.frameUrls.forEach((url) => URL.revokeObjectURL(url));
              return;
            }
            updateQueuedFile(item.id, {
              posterUrl: preview.posterUrl,
              previewFrameUrls: preview.frameUrls,
              metadata: {
                status: 'resolved',
                dimensions: { width: preview.width, height: preview.height },
                fileSizeBytes: file.size,
                contentType: file.type || undefined,
                sources: { dimensions: 'browser', fileSize: 'probe' },
              },
            });
          } catch {
            if (!queuedIdsRef.current.has(item.id)) return;
            updateQueuedFile(item.id, {
              metadata: {
                status: 'failed',
                fileSizeBytes: file.size,
                contentType: file.type || undefined,
              },
            });
          }
        });
      } finally {
        targets.forEach((item) => inflight.current.delete(item.id));
        running.current = false;
        setCycle((value) => value + 1);
      }
    };

    void run();
  }, [cycle, queuedFiles, updateQueuedFile]);
}
