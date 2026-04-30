import { describe, expect, it } from 'vitest';
import { defaultClientSiteVisibleTagPolicy } from '@/features/client-sites-publishing/defaults';
import { filterVisibleTags } from '@/features/client-sites-publishing/tagVisibility';

describe('client site visible tag filtering', () => {
  it('removes hidden prefixes and exact hidden tags', () => {
    const visibleTags = filterVisibleTags(
      ['portrait', 'x-search', 'internal:ops', '_favorite_', 'client-review'],
      defaultClientSiteVisibleTagPolicy
    );

    expect(visibleTags).toEqual(['portrait', 'client-review']);
  });
});
