import { describe, expect, it } from 'vitest';
import {
  FAVORITE_TAG,
  getUserVisibleTags,
  hasFavoriteTag,
  isBrowsableTag,
  mergeUserTagsPreservingSystemTags,
  normalizeTagKey,
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

describe('isBrowsableTag', () => {
  it.each([
    ['digest:01072026_124815_digest-this', 'namespaced system key'],
    ['signal:ec5808f44b2f', 'namespaced system key'],
    ['lat:34.14477139380641', 'namespaced coordinate'],
    ['uploaded:by=instagram', 'namespaced provenance'],
    ['meteringmode:center-weighted average', 'exif key/value'],
    ['iso 160', 'iso speed'],
    ['f/2.8', 'aperture'],
    ['35 mm', 'focal length'],
    ['24 mm f/1.4', 'focal length with aperture'],
    ['1.33 m', 'subject distance'],
    ['\u00b9\u2044\u2087\u2085\u2080 sec', 'shutter speed'],
    ['0 ev', 'exposure compensation'],
    ['-118.475425', 'gps longitude'],
    ['2007483', 'opaque numeric id'],
    ["33\u00b059'13.61 n 118\u00b028'31.53 w", 'dms coordinate'],
    ['nikon d3s', 'camera body'],
    ['leica summicron-m 35mm f/2 asph.', 'lens'],
    ['no flash', 'flash state'],
    ['aperture priority', 'exposure program'],
    ['win-ingest', 'ingest provenance'],
    ['source-original', 'ingest provenance'],
    ['slack-file', 'ingest provenance'],
    ['www.sketching07.com', 'url'],
    ['!flickr', 'leading punctuation'],
    ['#sketching14', 'hashtag'],
    ['\u221e', 'symbol only'],
    ['j', 'single character'],
    ['x-clip', 'control tag'],
    ['_favorite_', 'system tag'],
  ])('suppresses %s (%s)', (tag) => {
    expect(isBrowsableTag(tag)).toBe(false);
  });

  it.each([
    'skateboarding',
    'venice beach',
    'los angeles',
    'design fiction',
    'ars electronica',
    'orange beanie',
    'manual',
    'portrait',
    'landscape',
  ])('keeps %s', (tag) => {
    expect(isBrowsableTag(tag)).toBe(true);
  });

  it('keeps content tags that merely begin like a camera brand', () => {
    expect(isBrowsableTag('sonyboy')).toBe(true);
    expect(isBrowsableTag('canonical form')).toBe(true);
  });
});

describe('normalizeTagKey', () => {
  it('folds case, punctuation, and plural variants onto one key', () => {
    expect(normalizeTagKey('Technology')).toBe(normalizeTagKey('technology'));
    expect(normalizeTagKey('Design Fiction')).toBe(normalizeTagKey('design-fiction'));
    expect(normalizeTagKey('off road')).toBe(normalizeTagKey('off-road'));
    expect(normalizeTagKey('offroad')).toBe(normalizeTagKey('off-road'));
    expect(normalizeTagKey('sports')).toBe(normalizeTagKey('sport'));
    expect(normalizeTagKey('skateboarders')).toBe(normalizeTagKey('skateboarder'));
    expect(normalizeTagKey('skate park')).toBe(normalizeTagKey('skatepark'));
  });

  it('keeps distinct concepts distinct', () => {
    expect(normalizeTagKey('skateboarding')).not.toBe(normalizeTagKey('skateboarder'));
    expect(normalizeTagKey('venice beach')).not.toBe(normalizeTagKey('venice'));
    expect(normalizeTagKey('glass')).not.toBe(normalizeTagKey('gla'));
  });

  it('does not strip a trailing s from short stems', () => {
    expect(normalizeTagKey('gas')).toBe('gas');
    expect(normalizeTagKey('bus')).toBe('bus');
  });
});
