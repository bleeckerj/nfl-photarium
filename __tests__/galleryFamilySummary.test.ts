import { describe, expect, it } from 'vitest';
import { buildFamilySummaryMap } from '@/components/gallery/utils';
import type { CloudflareImage } from '@/components/gallery/types';

const makeImage = (overrides: Partial<CloudflareImage>): CloudflareImage => ({
  id: overrides.id ?? 'image-1',
  filename: overrides.filename ?? 'image.jpg',
  uploaded: overrides.uploaded ?? '2026-01-01T00:00:00.000Z',
  variants: overrides.variants ?? [],
  assetType: overrides.assetType,
  parentId: overrides.parentId,
});

describe('buildFamilySummaryMap', () => {
  it('summarizes a root image with multiple children', () => {
    const summary = buildFamilySummaryMap([
      makeImage({ id: 'root' }),
      makeImage({ id: 'child-a', parentId: 'root' }),
      makeImage({ id: 'child-b', parentId: 'root' }),
    ]);

    expect(summary.root).toEqual({
      imageId: 'root',
      rootId: 'root',
      parentId: undefined,
      parentAssetType: undefined,
      isVariant: false,
      variantCount: 2,
      childIds: ['child-a', 'child-b'],
    });
  });

  it('marks child images as variants of their parent', () => {
    const summary = buildFamilySummaryMap([
      makeImage({ id: 'root', assetType: 'video' }),
      makeImage({ id: 'child', parentId: 'root' }),
    ]);

    expect(summary.child).toMatchObject({
      imageId: 'child',
      rootId: 'root',
      parentId: 'root',
      parentAssetType: 'video',
      isVariant: true,
      variantCount: 1,
      childIds: ['child'],
    });
  });

  it('keeps missing-parent children identifiable as variants', () => {
    const summary = buildFamilySummaryMap([
      makeImage({ id: 'orphan-child', parentId: 'missing-root' }),
    ]);

    expect(summary['orphan-child']).toMatchObject({
      rootId: 'missing-root',
      parentId: 'missing-root',
      parentAssetType: undefined,
      isVariant: true,
      variantCount: 1,
      childIds: ['orphan-child'],
    });
  });
});
