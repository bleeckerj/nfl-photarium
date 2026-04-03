import { describe, expect, it } from 'vitest';
import { resolveVisibleTags, sanitizeVisibleTags } from '../src/worker/assets/tag-policy';

describe('asset tag policy', () => {
  const policy = {
    mode: 'prefix-filter' as const,
    hiddenPrefixes: ['x-', 'internal:'],
    hiddenExact: ['x-search'],
  };

  it('prefers explicit visible tags from the manifest', () => {
    expect(
      resolveVisibleTags(
        {
          visibleTags: ['dewalt', 'headphones'],
          sourceTags: ['dewalt', 'headphones', 'yellow'],
        },
        policy
      )
    ).toEqual(['dewalt', 'headphones']);
  });

  it('sanitizes hidden tags when visible tags are not provided', () => {
    expect(
      sanitizeVisibleTags(['found', 'internal:seed', 'x-search', 'x-clip'], policy)
    ).toEqual(['found']);
  });
});
