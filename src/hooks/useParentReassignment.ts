import { useMemo } from 'react';
import { buildParentReassignmentState } from '@/hooks/parentReassignmentUtils';
import type { VariantAssignmentCandidate } from '@/utils/variantAssignmentCandidates';

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
  namespace?: string;
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
  assignmentCandidates: VariantAssignmentCandidate<ParentReassignmentImage>[];
  reassignParentOptions: ParentOption[];
} {
  const state = useMemo(
    () =>
      buildParentReassignmentState({
        allImages,
        currentImage,
        excludeId,
      }),
    [allImages, currentImage, excludeId]
  );

  return {
    parentImage: state.parentImage,
    adoptableImages: state.adoptableImages,
    assignmentCandidates: state.assignmentCandidates,
    reassignParentOptions: state.reassignParentOptions,
  };
}
