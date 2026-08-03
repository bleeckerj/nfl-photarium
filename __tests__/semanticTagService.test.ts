import { describe, expect, it } from 'vitest';

import { mergeSemanticTags } from '@/server/semanticTagService';

describe('semantic tag merging', () => {
  it('preserves system tags and appends only case-insensitive new semantic tags', () => {
    expect(mergeSemanticTags(['Portrait', '_favorite_'], ['portrait', 'glasses', 'Pixel'])).toEqual({
      tags: ['Portrait', 'glasses', 'Pixel', '_favorite_'],
      appendedTags: ['glasses', 'Pixel'],
    });
  });
});
