type FamilyImage = { id: string; uploaded: string; variationSort?: number };

export const sortFamilyMembers = <T extends FamilyImage>(items: T[]) => {
  const hasSort = items.some((item) => Number.isFinite(item.variationSort));
  if (!hasSort) {
    return [...items].sort((a, b) => {
      const aUploaded = Date.parse(a.uploaded);
      const bUploaded = Date.parse(b.uploaded);
      const aTime = Number.isFinite(aUploaded) ? aUploaded : 0;
      const bTime = Number.isFinite(bUploaded) ? bUploaded : 0;
      if (aTime !== bTime) {
        return aTime - bTime;
      }
      return a.id.localeCompare(b.id);
    });
  }

  const fallbackIndex = new Map(
    [...items]
      .sort((a, b) => {
        const aUploaded = Date.parse(a.uploaded);
        const bUploaded = Date.parse(b.uploaded);
        const aTime = Number.isFinite(aUploaded) ? aUploaded : 0;
        const bTime = Number.isFinite(bUploaded) ? bUploaded : 0;
        if (aTime !== bTime) {
          return aTime - bTime;
        }
        return a.id.localeCompare(b.id);
      })
      .map((item, index) => [item.id, index])
  );

  return [...items].sort((a, b) => {
    const aSort = Number.isFinite(a.variationSort) ? (a.variationSort as number) : null;
    const bSort = Number.isFinite(b.variationSort) ? (b.variationSort as number) : null;
    if (aSort === null && bSort === null) {
      return (fallbackIndex.get(a.id) ?? 0) - (fallbackIndex.get(b.id) ?? 0);
    }
    if (aSort === null) return 1;
    if (bSort === null) return -1;
    if (aSort !== bSort) return aSort - bSort;
    return (fallbackIndex.get(a.id) ?? 0) - (fallbackIndex.get(b.id) ?? 0);
  });
};
