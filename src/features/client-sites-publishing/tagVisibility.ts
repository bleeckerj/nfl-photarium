import type { ClientSiteVisibleTagPolicy } from './types';

export const filterVisibleTags = (
  sourceTags: string[] | undefined,
  policy: ClientSiteVisibleTagPolicy
): string[] => {
  if (!Array.isArray(sourceTags) || sourceTags.length === 0) return [];

  return sourceTags.filter((tag) => {
    const exactHidden = policy.hiddenExact.includes(tag);
    const prefixHidden = policy.hiddenPrefixes.some((prefix) => tag.startsWith(prefix));
    return !exactHidden && !prefixHidden;
  });
};

