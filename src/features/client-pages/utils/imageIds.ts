export const dedupeImageIds = (imageIds: string[]): string[] => {
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const imageId of imageIds) {
    const trimmed = imageId.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    ordered.push(trimmed);
  }

  return ordered;
};
