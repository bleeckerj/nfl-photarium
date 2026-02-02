import { useCallback, useEffect, useState } from 'react';
import { deleteImage, fetchDeleteFamilyStatus, startDeleteFamilyJob, type DeleteFamilyJobStatus } from '@/services/imageDeletionService';

type Toast = { push: (message: string) => void };

type ImageLike = {
  id: string;
  parentId?: string;
} | null;

type UseDeleteImageFamilyParams = {
  image: ImageLike;
  isChildImage: boolean;
  toast: Toast;
};

export function useDeleteImageFamily({ image, isChildImage, toast }: UseDeleteImageFamilyParams) {
  const [deleteFamilyJobId, setDeleteFamilyJobId] = useState<string | null>(null);
  const [deleteFamilyStatus, setDeleteFamilyStatus] = useState<DeleteFamilyJobStatus | null>(null);
  const [deleteFamilyOpen, setDeleteFamilyOpen] = useState(false);

  const closeDeleteFamilyModal = useCallback(() => {
    setDeleteFamilyOpen(false);
  }, []);

  const handleDeleteParent = useCallback(async () => {
    if (!image) return;
    if (!confirm('Delete this image permanently? Variations will remain (and may need reassignment).')) return;
    try {
      await deleteImage(image.id);
      toast.push('Image deleted');
      window.location.href = '/';
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete image';
      toast.push(message);
    }
  }, [image, toast]);

  const handleDeleteCurrent = useCallback(async () => {
    if (!image) return;
    const prompt = isChildImage
      ? 'Delete this image variation permanently?'
      : 'Delete this image permanently? Variations will remain (and may need reassignment).';
    if (!confirm(prompt)) return;
    try {
      await deleteImage(image.id);
      toast.push('Image deleted');
      window.location.href = '/';
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete image';
      toast.push(message);
    }
  }, [image, isChildImage, toast]);

  const handleDeleteFamily = useCallback(async () => {
    if (!image) return;

    const warning =
      'This will permanently delete this image AND all variations in its family.\n\n' +
      'Type DELETE FAMILY to confirm.';
    const typed = window.prompt(warning);
    if (typed !== 'DELETE FAMILY') {
      return;
    }

    try {
      setDeleteFamilyOpen(true);
      setDeleteFamilyStatus(null);
      setDeleteFamilyJobId(null);

      const jobId = await startDeleteFamilyJob(image.id);
      setDeleteFamilyJobId(jobId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete image family';
      toast.push(message);
      setDeleteFamilyOpen(false);
    }
  }, [image, toast]);

  useEffect(() => {
    if (!deleteFamilyOpen) return;
    if (!deleteFamilyJobId) return;

    let cancelled = false;
    let interval: number | null = null;

    const poll = async () => {
      try {
        const data = await fetchDeleteFamilyStatus(deleteFamilyJobId);
        if (cancelled) return;

        setDeleteFamilyStatus(data);

        if (data.status !== 'running') {
          if (interval !== null) window.clearInterval(interval);
          interval = null;

          if (data.status === 'completed') {
            toast.push(`Deleted ${data.deleted} images${data.failed ? `; ${data.failed} failed` : ''}`);
            window.location.href = '/';
          } else {
            toast.push(data.lastError || 'Delete family failed');
          }
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Failed to fetch delete progress';
          toast.push(message);
        }
      }
    };

    void poll();
    interval = window.setInterval(poll, 500);

    return () => {
      cancelled = true;
      if (interval !== null) window.clearInterval(interval);
    };
  }, [deleteFamilyJobId, deleteFamilyOpen, toast]);

  return {
    deleteFamilyOpen,
    deleteFamilyStatus,
    closeDeleteFamilyModal,
    handleDeleteParent,
    handleDeleteCurrent,
    handleDeleteFamily
  };
}
