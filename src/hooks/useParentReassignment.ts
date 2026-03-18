import { useMemo } from 'react';

export type ParentReassignmentImage = {
  id: string;
  assetType?: 'image' | 'video';
  filename: string;
  displayName?: string;
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

  const canonicalCandidates = useMemo(() => {
    return allImages.filter((img) => {
      if (img.parentId) return false;
      if (excludeId && img.id === excludeId) return false;
      return true;
    });
  }, [allImages, excludeId]);

  const parentCandidates = useMemo(
    () => canonicalCandidates.filter((img) => img.assetType !== 'video'),
    [canonicalCandidates]
  );

  const adoptableImages = useMemo(() => {
    return canonicalCandidates;
  }, [canonicalCandidates]);

  const reassignParentOptions = useMemo(
    () => [
      { value: '', label: 'No parent (make canonical)' },
      ...parentCandidates.map((candidate) => ({
        value: candidate.id,
        label: `${candidate.displayName || candidate.filename || candidate.id} · ${candidate.id}`,
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
