import { describe, expect, it } from 'vitest';
import { queryGalleryAssets, type GalleryQueryAsset } from '@/server/galleryQuery';

const hash = 'a'.repeat(64);

const asset = (overrides: Partial<GalleryQueryAsset> & { id: string }): GalleryQueryAsset => ({
  id: overrides.id,
  filename: `${overrides.id}.jpg`,
  uploaded: '2026-01-01T00:00:00.000Z',
  variants: ['public'],
  ...overrides,
});

describe('queryGalleryAssets', () => {
  it('returns only the requested page with pagination metadata and full-catalog facets', () => {
    const result = queryGalleryAssets(
      [
        asset({ id: 'a', folder: 'editorial', tags: ['hero'], uploaded: '2026-01-03T00:00:00.000Z' }),
        asset({ id: 'b', folder: 'editorial', tags: ['detail'], uploaded: '2026-01-02T00:00:00.000Z' }),
        asset({ id: 'c', folder: 'archive', tags: ['hero'], uploaded: '2026-01-01T00:00:00.000Z' }),
      ],
      {},
      1,
      2
    );

    expect(result.images.map((image) => image.id)).toEqual(['a', 'b']);
    expect(result.total).toBe(3);
    expect(result.totalPages).toBe(2);
    expect(result.facets.folders).toEqual([
      { value: 'archive', count: 1 },
      { value: 'editorial', count: 2 },
    ]);
    expect(result.facets.tags).toEqual([
      { value: 'detail', count: 1 },
      { value: 'hero', count: 2 },
    ]);
  });

  it('applies search, folder, tag, hidden tag, and hidden folder filters before pagination', () => {
    const result = queryGalleryAssets(
      [
        asset({ id: 'match', displayName: 'Blue chair', folder: 'editorial', tags: ['hero'] }),
        asset({ id: 'wrong-folder', displayName: 'Blue chair', folder: 'archive', tags: ['hero'] }),
        asset({ id: 'wrong-tag', displayName: 'Blue chair', folder: 'editorial', tags: ['detail'] }),
        asset({ id: 'hidden-folder', displayName: 'Blue chair', folder: 'hidden', tags: ['hero'] }),
        asset({ id: 'hidden-tag', displayName: 'Blue chair', folder: 'editorial', tags: ['hero', 'private'] }),
      ],
      {
        search: 'blue',
        folder: 'editorial',
        tag: 'hero',
        hiddenFolders: ['hidden'],
        hiddenTags: ['private'],
      },
      1,
      60
    );

    expect(result.images.map((image) => image.id)).toEqual(['match']);
    expect(result.total).toBe(1);
    expect(result.facets.folders).toEqual([
      { value: 'archive', count: 1 },
      { value: 'editorial', count: 2 },
    ]);
  });

  it('returns duplicate summaries and filters duplicate mode server-side', () => {
    const result = queryGalleryAssets(
      [
        asset({ id: 'dupe-1', originalUrlNormalized: 'https://example.com/a.jpg', contentHash: hash }),
        asset({ id: 'dupe-2', originalUrlNormalized: 'https://example.com/a.jpg', contentHash: hash }),
        asset({ id: 'unique', originalUrlNormalized: 'https://example.com/b.jpg', contentHash: 'b'.repeat(64) }),
      ],
      { duplicates: true },
      1,
      60
    );

    expect(result.images.map((image) => image.id)).toEqual(['dupe-1', 'dupe-2']);
    expect(result.duplicateSummary.groupCount).toBe(1);
    expect(result.duplicateSummary.imageCount).toBe(2);
    expect(result.duplicateSummary.pageDuplicateIds).toEqual(['dupe-1', 'dupe-2']);
  });

  it('returns page-local family summaries computed from the full catalog', () => {
    const result = queryGalleryAssets(
      [
        asset({ id: 'parent', uploaded: '2026-01-03T00:00:00.000Z' }),
        asset({ id: 'child', parentId: 'parent', uploaded: '2026-01-02T00:00:00.000Z' }),
        asset({ id: 'other', uploaded: '2026-01-01T00:00:00.000Z' }),
      ],
      { onlyWithVariants: true },
      1,
      60
    );

    expect(result.images.map((image) => image.id)).toEqual(['parent']);
    expect(result.familySummaryMap.parent).toMatchObject({
      isVariant: false,
      variantCount: 1,
      childIds: ['child'],
    });
  });
});
