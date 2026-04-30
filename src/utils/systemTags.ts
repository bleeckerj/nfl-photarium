export const FAVORITE_TAG = '_favorite_';

const normalizeTag = (tag: string) => tag.trim().toLowerCase();

export const isSystemTag = (tag: string): boolean => {
  const normalized = normalizeTag(tag);
  return normalized.startsWith('_') && normalized.endsWith('_');
};

export const getUserVisibleTags = (tags: string[] | undefined): string[] => {
  if (!Array.isArray(tags)) return [];
  return tags.map(tag => tag.trim()).filter(tag => tag && !isSystemTag(tag));
};

export const hasFavoriteTag = (tags: string[] | undefined): boolean => {
  if (!Array.isArray(tags)) return false;
  return tags.some(tag => normalizeTag(tag) === FAVORITE_TAG);
};

const dedupeTags = (tags: string[]) => {
  const seen = new Set<string>();
  const deduped: string[] = [];
  tags.forEach((tag) => {
    const trimmed = tag.trim();
    const normalized = normalizeTag(trimmed);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    deduped.push(trimmed);
  });
  return deduped;
};

export const setFavoriteTag = (
  tags: string[] | undefined,
  favorite: boolean
): string[] => {
  const existing = dedupeTags(Array.isArray(tags) ? tags : []);
  const withoutFavorite = existing.filter(tag => normalizeTag(tag) !== FAVORITE_TAG);
  return favorite ? [...withoutFavorite, FAVORITE_TAG] : withoutFavorite;
};

export const mergeUserTagsPreservingSystemTags = (
  existingTags: string[] | undefined,
  nextUserTags: string[] | undefined
): string[] => {
  const systemTags = dedupeTags(Array.isArray(existingTags) ? existingTags.filter(isSystemTag) : []);
  const userTags = dedupeTags(Array.isArray(nextUserTags) ? nextUserTags.filter(tag => !isSystemTag(tag)) : []);
  return [...userTags, ...systemTags];
};
