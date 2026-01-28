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

  const adoptableImages = useMemo(() => {
    return allImages.filter((img) => {
      if (img.parentId) return false;
      if (parentWithChildren.has(img.id)) return false;
      if (excludeId && img.id === excludeId) return false;
      return true;
    });
  }, [allImages, excludeId, parentWithChildren]);

  const reassignParentOptions = useMemo(
    () => [
      { value: '', label: 'No parent (make canonical)' },
      ...adoptableImages.map((candidate) => ({
        value: candidate.id,
        label: candidate.filename || candidate.id,
      })),
    ],
    [adoptableImages]
  );

  return {
    parentImage,
    adoptableImages,
    reassignParentOptions,
  };
}
