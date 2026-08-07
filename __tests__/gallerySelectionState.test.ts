import { describe, expect, it } from 'vitest';

import { mergeVisibleImagesIntoSelection } from '@/components/gallery/selectionState';
import type { CloudflareImage } from '@/components/gallery/types';

const image = (id: string, filename = `${id}.jpg`): CloudflareImage => ({
  id,
  filename,
  uploaded: '2026-08-06T00:00:00.000Z',
  variants: [],
});

describe('gallery selection state', () => {
  it('keeps records from earlier pages when the visible page changes', () => {
    const pageOneImage = image('page-one');
    const pageFourImage = image('page-four');
    const pageOneSelection = new Map([[pageOneImage.id, pageOneImage]]);

    const selection = mergeVisibleImagesIntoSelection(
      pageOneSelection,
      [pageFourImage],
      new Set([pageOneImage.id, pageFourImage.id])
    );

    expect([...selection.keys()]).toEqual(['page-one', 'page-four']);
  });

  it('refreshes metadata for selected assets when they become visible again', () => {
    const oldImage = image('asset', 'old.jpg');
    const refreshedImage = image('asset', 'new.jpg');

    const selection = mergeVisibleImagesIntoSelection(
      new Map([[oldImage.id, oldImage]]),
      [refreshedImage],
      new Set([oldImage.id])
    );

    expect(selection.get('asset')?.filename).toBe('new.jpg');
  });
});
