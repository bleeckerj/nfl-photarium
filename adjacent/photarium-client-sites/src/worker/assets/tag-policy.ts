import type { PublishedProjectAsset, VisibleTagPolicy } from '../publishing-contract/types';

export const sanitizeVisibleTags = (candidateTags: string[], policy: VisibleTagPolicy): string[] =>
  candidateTags.filter((tag) => {
    const exactHidden = policy.hiddenExact.includes(tag);
    const prefixHidden = policy.hiddenPrefixes.some((prefix) => tag.startsWith(prefix));
    return !exactHidden && !prefixHidden;
  });

export const resolveVisibleTags = (
  asset: Pick<PublishedProjectAsset, 'visibleTags' | 'sourceTags'>,
  policy: VisibleTagPolicy
): string[] => sanitizeVisibleTags(asset.visibleTags ?? asset.sourceTags, policy);
