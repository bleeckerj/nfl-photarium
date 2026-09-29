import { createWholeWordMatcher } from '@/utils/wholeWordSearch';

type SearchableGalleryAsset = {
  id: string;
  filename?: string;
  displayName?: string;
  promptThis?: string;
  folder?: string;
  altTag?: string;
  altText?: string;
  description?: string;
  originalUrl?: string;
  originalUrlNormalized?: string;
  sourceUrl?: string;
  sourceUrlNormalized?: string;
  tags?: string[];
  variants?: string[];
};

const stripQuery = (value: string) => value.split('?')[0];
const splitCamelCase = (value = '') => value
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');

/** Shared by browser filtering and server pagination so both return the same matches. */
export function createGalleryTextMatcher(search = '') {
  const query = search.trim();
  const matches = createWholeWordMatcher(query);
  // Preserve pasted URL lookup when tracking parameters differ.
  const withoutQuery = /^https?:\/\//i.test(query) ? stripQuery(query) : query;
  const matchesWithoutQuery = withoutQuery !== query ? createWholeWordMatcher(withoutQuery) : matches;

  return (asset: SearchableGalleryAsset, extrasSearchText?: string): boolean => {
    if (!query) return true;
    if (extrasSearchText && matches(extrasSearchText)) return true;
    const values = [
      asset.id, asset.filename, asset.displayName, splitCamelCase(asset.displayName),
      asset.promptThis, asset.folder, asset.altTag, asset.altText, asset.description,
      asset.originalUrl, asset.originalUrlNormalized, asset.sourceUrl, asset.sourceUrlNormalized,
      ...(asset.tags ?? []), ...(asset.variants ?? []),
    ];
    return values.some((value) => Boolean(value && (matches(value) || matchesWithoutQuery(value))));
  };
}
