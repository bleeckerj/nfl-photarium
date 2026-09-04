import { useCallback, useState } from 'react';

export type ExifPushMode = 'fill-missing' | 'overwrite';

type Toast = {
  push: (message: string) => void;
};

type UseExifPropagationParams = {
  imageId?: string;
  /** Number of family members the server will consider; used only for messaging. */
  targetCount: number;
  toast: Toast;
  /** Runs after a successful push so the page can refetch image + family state. */
  onPushed?: () => Promise<void> | void;
};

type PushExifResponse = {
  error?: string;
  updatedIds?: unknown;
  skipped?: unknown;
  failed?: unknown;
};

const countArray = (value: unknown) => (Array.isArray(value) ? value.length : 0);

/**
 * Client side of `POST /api/images/:id/push-exif`. The server decides the
 * target set (variants for a parent, parent + siblings for a variant); this
 * hook only owns the in-flight flag and user-facing summary.
 */
export function useExifPropagation({ imageId, targetCount, toast, onPushed }: UseExifPropagationParams) {
  const [exifPushing, setExifPushing] = useState(false);

  const pushExif = useCallback(async (mode: ExifPushMode = 'fill-missing') => {
    if (!imageId) return;
    if (targetCount === 0) {
      toast.push('No family members to push EXIF to');
      return;
    }
    setExifPushing(true);
    try {
      const response = await fetch(`/api/images/${encodeURIComponent(imageId)}/push-exif`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, concurrency: 4 }),
      });
      const payload = (await response.json().catch(() => ({}))) as PushExifResponse;
      if (!response.ok && response.status !== 207) {
        throw new Error(payload.error || 'Failed to push EXIF');
      }

      const updated = countArray(payload.updatedIds);
      const skipped = countArray(payload.skipped);
      const failed = countArray(payload.failed);
      const parts = [`EXIF pushed to ${updated}`];
      if (skipped) parts.push(`${skipped} already had EXIF`);
      if (failed) parts.push(`${failed} failed`);
      toast.push(parts.join(', '));

      if (updated > 0 && onPushed) {
        await onPushed();
      }
    } catch (error) {
      console.error('Failed to push EXIF', error);
      toast.push(error instanceof Error ? error.message : 'Failed to push EXIF');
    } finally {
      setExifPushing(false);
    }
  }, [imageId, onPushed, targetCount, toast]);

  return { exifPushing, pushExif };
}
