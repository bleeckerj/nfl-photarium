import type { ParentOption, ParentReassignmentImage } from '@/hooks/useParentReassignment';
import {
  buildVariantAssignmentCandidates,
  listAvailableVariantAssignmentAssets,
  type VariantAssignmentCandidate,
} from '@/utils/variantAssignmentCandidates';

type ParentReassignmentState = {
  parentImage: ParentReassignmentImage | null;
  adoptableImages: ParentReassignmentImage[];
  assignmentCandidates: VariantAssignmentCandidate<ParentReassignmentImage>[];
  reassignParentOptions: ParentOption[];
};

const normalizeNamespace = (value?: string) => (typeof value === 'string' ? value.trim() : '');

const uniqueById = (assets: ParentReassignmentImage[]) => {
  const seen = new Set<string>();
  return assets.filter((asset) => {
    if (seen.has(asset.id)) {
      return false;
    }
    seen.add(asset.id);
    return true;
  });
};

export const buildParentReassignmentState = ({
  allImages,
  currentImage,
  excludeId,
}: {
  allImages: ParentReassignmentImage[];
  currentImage: ParentReassignmentImage | null;
  excludeId?: string;
}): ParentReassignmentState => {
  const parentId = currentImage?.parentId;
  const parentImage = parentId
    ? allImages.find((img) => img.id === parentId) || null
    : null;
  const familyRootId = parentId || currentImage?.id || '';
  const scopeNamespace = normalizeNamespace(parentImage?.namespace || currentImage?.namespace);

  const assignmentCandidates = buildVariantAssignmentCandidates({
    assets: allImages,
    currentAssetId: excludeId,
    familyRootId,
    namespace: scopeNamespace,
    includeCrossNamespaceOrphans: true,
  });
  const namespaceScopedAssignmentCandidates = buildVariantAssignmentCandidates({
    assets: allImages,
    currentAssetId: excludeId,
    familyRootId,
    namespace: scopeNamespace,
  });
  const canonicalCandidates = listAvailableVariantAssignmentAssets(namespaceScopedAssignmentCandidates);

  const parentCandidates = uniqueById(
    [
      ...(parentImage && !parentImage.parentId ? [parentImage] : []),
      ...canonicalCandidates,
    ].filter((img) => img.assetType !== 'video')
  );

  const adoptableImages = canonicalCandidates.filter((img) => img.id !== familyRootId);

  const reassignParentOptions: ParentOption[] = [
    { value: '', label: 'No parent (make canonical)' },
    ...parentCandidates.map((candidate) => ({
      value: candidate.id,
      label: `${candidate.displayName || candidate.filename || candidate.id} · ${candidate.id}`,
    })),
  ];

  return {
    parentImage,
    adoptableImages,
    assignmentCandidates,
    reassignParentOptions,
  };
};
