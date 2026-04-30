import { describe, expect, it } from 'vitest';
import {
  FAVORITE_TAG,
  getUserVisibleTags,
  hasFavoriteTag,
  mergeUserTagsPreservingSystemTags,
  setFavoriteTag,
} from '@/utils/systemTags';

describe('system tag helpers', () => {
  it('adds and removes the favorite tag without duplicating it', () => {
    expect(setFavoriteTag(['hero'], true)).toEqual(['hero', FAVORITE_TAG]);
    expect(setFavoriteTag(['hero', FAVORITE_TAG], true)).toEqual(['hero', FAVORITE_TAG]);
    expect(setFavoriteTag(['hero', FAVORITE_TAG], false)).toEqual(['hero']);
  });

  it('detects favorites case-insensitively', () => {
    expect(hasFavoriteTag(['hero', '_FAVORITE_'])).toBe(true);
    expect(hasFavoriteTag(['hero'])).toBe(false);
  });

  it('filters system tags from visible tag lists', () => {
    expect(getUserVisibleTags(['hero', FAVORITE_TAG, '_internal_'])).toEqual(['hero']);
  });

  it('merges edited user tags while preserving existing system tags', () => {
    expect(mergeUserTagsPreservingSystemTags(['old', FAVORITE_TAG], ['hero', '_private_'])).toEqual([
      'hero',
      FAVORITE_TAG,
    ]);
  });
});
