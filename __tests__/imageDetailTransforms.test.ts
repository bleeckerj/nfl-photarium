import { describe, expect, it } from 'vitest';
import {
  ensureWebpFormat,
  formatEntriesAsYaml,
  formatFailureNames,
  getVariantWidthLabel,
  isAnimatedWebpAsset,
  isMetadataLimitError,
  mergeFamilyContextImages,
  mergeUniqueTags,
  sortFamilyMembers,
  toCloudflareTextMirror,
} from '@/components/image-detail/detailTransforms';

describe('image detail transforms', () => {
  it('formats delivery URLs and variant labels', () => {
    expect(ensureWebpFormat('https://example.com/image/public')).toBe('https://example.com/image/public?format=webp');
    expect(ensureWebpFormat('https://example.com/image/public?foo=1')).toBe('https://example.com/image/public?foo=1&format=webp');
    expect(getVariantWidthLabel('thumbnail')).toMatch(/px$/);
  });

  it('summarizes metadata failures and mirrored text', () => {
    expect(isMetadataLimitError('Metadata size exceeds maximum')).toBe(true);
    expect(formatFailureNames([
      { id: '1', name: 'one' },
      { id: '2', name: 'two' },
      { id: '3', name: 'three' },
      { id: '4', name: 'four' },
    ])).toBe('one, two, three +1 more');
    expect(toCloudflareTextMirror(` ${'x'.repeat(200)} `)).toHaveLength(161);
  });

  it('formats selected image entries as yaml', () => {
    expect(formatEntriesAsYaml([{ url: 'https://example.com/a.webp', altText: 'A "quote"' }])).toBe(
      'imagesFromGridDirectory:\n  - url: https://example.com/a.webp\n    altText: "A \\"quote\\""'
    );
  });

  it('merges tags and family context without keeping stale family entries', () => {
    expect(mergeUniqueTags(['Hero', ' editorial '], ['hero', 'New'])).toEqual(['Hero', 'editorial', 'New']);
    expect(mergeFamilyContextImages(
      [
        { id: 'root', uploaded: '2026-01-01T00:00:00Z' },
        { id: 'stale-child', parentId: 'root', uploaded: '2026-01-02T00:00:00Z' },
        { id: 'outside', uploaded: '2026-01-03T00:00:00Z' },
      ],
      [{ id: 'new-child', parentId: 'root', uploaded: '2026-01-04T00:00:00Z' }],
      'root'
    ).map((image) => image.id)).toEqual(['outside', 'new-child']);
  });

  it('sorts family members by variation sort with uploaded fallback', () => {
    expect(sortFamilyMembers([
      { id: 'b', uploaded: '2026-01-02T00:00:00Z' },
      { id: 'a', uploaded: '2026-01-01T00:00:00Z', variationSort: 2 },
      { id: 'c', uploaded: '2026-01-03T00:00:00Z', variationSort: 1 },
    ]).map((image) => image.id)).toEqual(['c', 'a', 'b']);
  });

  it('detects animated webp assets', () => {
    expect(isAnimatedWebpAsset({ filename: 'motion.webp', contentType: 'image/webp' })).toBe(true);
    expect(isAnimatedWebpAsset({ filename: 'still.png', tags: ['animated-webp'] })).toBe(true);
    expect(isAnimatedWebpAsset({ assetType: 'video', filename: 'clip.mp4', isAnimated: true })).toBe(false);
  });
});
