import { describe, expect, it } from 'vitest';
import { queryGalleryAssets, type GalleryQueryAsset } from '@/server/galleryQuery';
import { formatDateRangeLabel } from '@/components/gallery/utils';

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
    expect(result.duplicateSummary).toBeNull();
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

  it('matches search against extras description and prompt text outside the catalog', () => {
    const result = queryGalleryAssets(
      [
        asset({ id: 'described' }),
        asset({ id: 'prompted' }),
        asset({ id: 'unrelated' }),
      ],
      { search: 'Lighthouse' },
      1,
      60,
      undefined,
      undefined,
      {
        extrasSearchTextById: new Map([
          ['described', 'a red lighthouse at dawn'],
          ['prompted', 'wide shot of a lighthouse, storm clouds, 35mm'],
        ]),
      }
    );

    expect(result.images.map((image) => image.id).sort()).toEqual(['described', 'prompted']);
    expect(result.total).toBe(2);
  });

  it('filters hidden namespaces before pagination and facet counts', () => {
    const result = queryGalleryAssets(
      [
        asset({ id: 'flickr', namespace: 'cf-flickr', tags: ['source'] }),
        asset({ id: 'default', namespace: 'cf-default', tags: ['source'] }),
      ],
      { hiddenNamespaces: ['CF-FLICKR'] },
      1,
      60
    );

    expect(result.images.map(image => image.id)).toEqual(['default']);
    expect(result.total).toBe(1);
    expect(result.facets.tags).toEqual([{ value: 'source', count: 1 }]);
  });

  it('returns duplicate summaries and filters duplicate mode server-side', () => {
    const result = queryGalleryAssets(
      [
        asset({ id: 'dupe-1', originalUrlNormalized: 'https://example.com/a.jpg', contentHash: hash, uploaded: '2026-01-01T00:00:00.000Z' }),
        asset({ id: 'dupe-2', originalUrlNormalized: 'https://example.com/a.jpg', contentHash: hash, uploaded: '2026-01-02T00:00:00.000Z' }),
        asset({ id: 'unique', originalUrlNormalized: 'https://example.com/b.jpg', contentHash: 'b'.repeat(64) }),
      ],
      { duplicates: true },
      1,
      60
    );

    expect(result.images.map((image) => image.id)).toEqual(['dupe-2', 'dupe-1']);
    const summary = result.duplicateSummary;
    expect(summary).not.toBeNull();
    expect(summary?.groupCount).toBe(1);
    expect(summary?.imageCount).toBe(2);
    expect(summary?.pageDuplicateIds).toEqual(['dupe-2', 'dupe-1']);
    expect(summary?.allDuplicateIds).toEqual(['dupe-1', 'dupe-2']);
    expect(summary?.duplicateIdsExcludingNewest).toEqual(['dupe-1']);
    expect(summary?.duplicateIdsExcludingOldest).toEqual(['dupe-2']);
  });

  it('does not treat repeated rows for one asset as duplicate images', () => {
    const repeated = asset({
      id: 'same-asset',
      originalUrlNormalized: 'https://example.com/a.jpg',
      contentHash: hash,
    });
    const result = queryGalleryAssets(
      [repeated, { ...repeated }],
      {},
      1,
      60,
      undefined,
      undefined,
      { includeDuplicateSummary: true }
    );

    expect(result.duplicateSummary?.groupCount).toBe(0);
    expect(result.duplicateSummary?.imageCount).toBe(0);
    expect(result.duplicateSummary?.allDuplicateIds).toEqual([]);
    expect(result.duplicateSummary?.duplicateIdsExcludingNewest).toEqual([]);
  });

  it('returns global duplicate selection ids even when duplicate assets are off page', () => {
    const result = queryGalleryAssets(
      [
        asset({ id: 'new-visible', uploaded: '2026-01-04T00:00:00.000Z' }),
        asset({ id: 'older-dupe', originalUrlNormalized: 'https://example.com/a.jpg', contentHash: hash, uploaded: '2026-01-02T00:00:00.000Z' }),
        asset({ id: 'newer-dupe', originalUrlNormalized: 'https://example.com/a.jpg', contentHash: hash, uploaded: '2026-01-03T00:00:00.000Z' }),
      ],
      {},
      1,
      1,
      undefined,
      undefined,
      { includeDuplicateSummary: true }
    );

    expect(result.images.map((image) => image.id)).toEqual(['new-visible']);
    expect(result.duplicateSummary?.groupCount).toBe(1);
    expect(result.duplicateSummary?.pageDuplicateIds).toEqual([]);
    expect(result.duplicateSummary?.allDuplicateIds).toEqual(['older-dupe', 'newer-dupe']);
    expect(result.duplicateSummary?.duplicateIdsExcludingNewest).toEqual(['older-dupe']);
    expect(result.duplicateSummary?.duplicateIdsExcludingOldest).toEqual(['newer-dupe']);
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

  it('filters upload dates while preserving the unfiltered scope total', () => {
    const result = queryGalleryAssets(
      [
        asset({ id: 'newer', uploaded: '2026-02-03T12:00:00.000Z' }),
        asset({ id: 'match-end', uploaded: '2026-02-02T23:59:59.999Z' }),
        asset({ id: 'match-start', uploaded: '2026-02-01T00:00:00.000Z' }),
        asset({ id: 'older', uploaded: '2026-01-31T23:59:59.999Z' }),
      ],
      { dateStart: '2026-02-01', dateEnd: '2026-02-02' },
      1,
      60
    );

    expect(result.images.map((image) => image.id)).toEqual(['match-end', 'match-start']);
    expect(result.total).toBe(2);
    expect(result.scopeTotal).toBe(4);
  });

  it('filters upload dates in the requested display time zone', () => {
    const result = queryGalleryAssets(
      [
        asset({ id: 'local-evening', uploaded: '2026-06-01T02:48:25.565Z' }),
        asset({ id: 'next-local-day', uploaded: '2026-06-01T08:00:00.000Z' }),
      ],
      {
        dateStart: '2026-05-31',
        dateEnd: '2026-05-31',
        dateTimeZone: 'America/Los_Angeles',
      },
      1,
      60
    );

    expect(result.images.map((image) => image.id)).toEqual(['local-evening']);
    expect(result.total).toBe(1);
    expect(result.scopeTotal).toBe(2);
  });

  it('filters aspect ratios from persisted metadata when dimensions are unavailable', () => {
    const result = queryGalleryAssets(
      [
        asset({ id: 'square-ratio', aspectRatio: '1:1' }),
        asset({ id: 'square-class', aspectRatioClass: 'square' }),
        asset({ id: 'landscape-ratio', aspectRatio: '16:9' }),
        asset({ id: 'portrait-ratio', aspectRatio: '4:5' }),
        asset({ id: 'unknown' }),
      ],
      { aspectRatioClasses: ['square'] },
      1,
      60
    );

    expect(result.images.map((image) => image.id)).toEqual(['square-class', 'square-ratio']);
    expect(result.total).toBe(2);
  });

  it('filters aspect ratios from legacy top-level dimensions', () => {
    const result = queryGalleryAssets(
      [
        asset({ id: 'wide', width: 1600, height: 900 }),
        asset({ id: 'tall', width: 900, height: 1600 }),
        asset({ id: 'squareish', width: 1000, height: 1004 }),
      ],
      { aspectRatioClasses: ['horizontal'] },
      1,
      60
    );

    expect(result.images.map((image) => image.id)).toEqual(['wide']);
    expect(result.total).toBe(1);
  });

  it('applies aspect ratio filters to video assets', () => {
    const result = queryGalleryAssets(
      [
        asset({ id: 'horizontal-video', assetType: 'video', aspectRatio: '16:9' }),
        asset({ id: 'vertical-image', aspectRatio: '4:5' }),
        asset({ id: 'vertical-video', assetType: 'video', dimensions: { width: 720, height: 1280 } }),
      ],
      { aspectRatioClasses: ['vertical'] },
      1,
      60
    );

    expect(result.images.map((image) => image.id)).toEqual(['vertical-image', 'vertical-video']);
    expect(result.total).toBe(2);
  });

  it('formats page upload spans oldest to newest regardless of sort order', () => {
    expect(
      formatDateRangeLabel([
        asset({ id: 'newest', uploaded: '2026-05-31T12:00:00.000Z' }),
        asset({ id: 'oldest', uploaded: '2026-05-01T12:00:00.000Z' }),
      ] as GalleryQueryAsset[])
    ).toBe('May 1, 2026 - May 31, 2026');
  });

  it('locates a focused asset by sorted gallery order and returns its page', () => {
    const result = queryGalleryAssets(
      [
        asset({ id: 'newest', uploaded: '2026-02-04T00:00:00.000Z' }),
        asset({ id: 'target', uploaded: '2026-02-03T00:00:00.000Z' }),
        asset({ id: 'older', uploaded: '2026-02-02T00:00:00.000Z' }),
        asset({ id: 'oldest', uploaded: '2026-02-01T00:00:00.000Z' }),
      ],
      {},
      1,
      1,
      'target'
    );

    expect(result.images.map((image) => image.id)).toEqual(['target']);
    expect(result.page).toBe(2);
    expect(result.focus).toEqual({
      assetId: 'target',
      found: true,
      index: 1,
      ordinal: 2,
      page: 2,
      pageSize: 1,
      total: 4,
    });
  });

  it('reports a missing focused asset without changing requested pagination', () => {
    const result = queryGalleryAssets(
      [
        asset({ id: 'newer', uploaded: '2026-02-02T00:00:00.000Z' }),
        asset({ id: 'older', uploaded: '2026-02-01T00:00:00.000Z' }),
      ],
      {},
      2,
      1,
      'missing'
    );

    expect(result.images.map((image) => image.id)).toEqual(['older']);
    expect(result.page).toBe(2);
    expect(result.focus).toEqual({
      assetId: 'missing',
      found: false,
      index: -1,
      ordinal: 0,
      page: 2,
      pageSize: 1,
      total: 2,
    });
  });
});
