import { useCallback, useState } from 'react';
import { patchParentAssignment as patchParentAssignmentService } from '@/services/parentAssignmentService';

type ParentAssignmentToast = {
  push: (message: string) => void;
};

type ParentAssignmentImage = {
  id: string;
  parentId?: string;
} | null;

type UseParentAssignmentParams = {
  image: ParentAssignmentImage;
  reassignParentId: string;
  refreshImageList: () => Promise<void>;
  toast: ParentAssignmentToast;
};

export function useParentAssignment({
  image,
  reassignParentId,
  refreshImageList,
  toast
}: UseParentAssignmentParams) {
  const [parentActionLoading, setParentActionLoading] = useState(false);

  const patchParentAssignment = useCallback(async (targetId: string, parentIdValue: string) => {
    const payload = await patchParentAssignmentService(targetId, parentIdValue);
    await refreshImageList();
    return payload;
  }, [refreshImageList]);

  const handleDetachFromParent = useCallback(async () => {
    if (!image) return;
    setParentActionLoading(true);
    try {
      await patchParentAssignment(image.id, '');
      toast.push('Image detached from its parent');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to detach image';
      toast.push(message);
    } finally {
      setParentActionLoading(false);
    }
  }, [image, patchParentAssignment, toast]);

  const handleReassignParent = useCallback(async () => {
    if (!image) return;
    if (reassignParentId === (image.parentId ?? '')) {
      return;
    }
    setParentActionLoading(true);
    try {
      await patchParentAssignment(image.id, reassignParentId || '');
      toast.push('Parent updated');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update parent';
      toast.push(message);
    } finally {
      setParentActionLoading(false);
    }
  }, [image, patchParentAssignment, reassignParentId, toast]);

  return {
    parentActionLoading,
    patchParentAssignment,
    handleDetachFromParent,
    handleReassignParent
  };
}
