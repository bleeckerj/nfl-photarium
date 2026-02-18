import { useMemo } from 'react';

export type ParentReassignmentImage = {
  id: string;
  filename: string;
  uploaded: string;
  parentId?: string;
  folder?: string;
  description?: string;
  altTag?: string;
  tags?: string[];
};

export type ParentOption = { value: string; label: string };

export function useParentReassignment({
  allImages,
  currentImage,
  excludeId,
}: {
  allImages: ParentReassignmentImage[];
  currentImage: ParentReassignmentImage | null;
  excludeId?: string;
}): {
  parentImage: ParentReassignmentImage | null;
  adoptableImages: ParentReassignmentImage[];
  reassignParentOptions: ParentOption[];
} {
  const parentImage = useMemo(() => {
    const parentId = currentImage?.parentId;
    if (!parentId) return null;
    return allImages.find((img) => img.id === parentId) || null;
  }, [allImages, currentImage?.parentId]);

  const parentWithChildren = useMemo(() => {
    const set = new Set<string>();
    allImages.forEach((img) => {
      if (img.parentId) {
        set.add(img.parentId);
      }
    });
    return set;
  }, [allImages]);

  const parentCandidates = useMemo(() => {
    return allImages.filter((img) => {
      if (img.parentId) return false;
      if (excludeId && img.id === excludeId) return false;
      return true;
    });
  }, [allImages, excludeId]);

  const adoptableImages = useMemo(() => {
    return parentCandidates.filter((img) => !parentWithChildren.has(img.id));
  }, [parentCandidates, parentWithChildren]);

  const reassignParentOptions = useMemo(
    () => [
      { value: '', label: 'No parent (make canonical)' },
      ...parentCandidates.map((candidate) => ({
        value: candidate.id,
        label: candidate.filename || candidate.id,
      })),
    ],
    [parentCandidates]
  );

  return {
    parentImage,
    adoptableImages,
    reassignParentOptions,
  };
}
