export type ImageWithParent = {
  id: string;
  parentId?: string | null;
};

export function listImageFamilyIds(
  images: ImageWithParent[],
  imageId: string
): { rootId: string; memberIds: string[] } {
  const target = images.find((img) => img.id === imageId);
  const rootId = (target?.parentId ?? '') ? (target!.parentId as string) : imageId;

  const memberSet = new Set<string>();
  for (const image of images) {
    if (image.id === rootId || image.parentId === rootId) {
      memberSet.add(image.id);
    }
  }

  // If cache is missing the parent record, still include rootId.
  memberSet.add(rootId);

  const memberIds = Array.from(memberSet);
  // Delete children first, then the root image last.
  memberIds.sort((a, b) => {
    if (a === rootId && b !== rootId) return 1;
    if (b === rootId && a !== rootId) return -1;
    return 0;
  });

  return { rootId, memberIds };
}
