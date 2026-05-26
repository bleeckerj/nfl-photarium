import { describe, expect, it } from 'vitest';
import { collectFacetFolders, collectImageFolders, mergeFolderNames } from '@/components/gallery/folderOptions';

describe('gallery folder option helpers', () => {
  it('merges server facet folders with optimistic image folders', () => {
    const facetFolders = collectFacetFolders([
      { value: 'old-folder' },
      { value: 'archive' },
      { value: '8-bit G Wagon' },
    ]);
    const imageFolders = collectImageFolders([
      { folder: 'new-folder' },
      { folder: '640-walls' },
      { folder: 'archive' },
      { folder: '  ' },
    ]);

    expect(mergeFolderNames(facetFolders, imageFolders)).toEqual([
      '640-walls',
      '8-bit G Wagon',
      'archive',
      'new-folder',
      'old-folder',
    ]);
  });

  it('keeps hidden and currently selected folders available for controls', () => {
    expect(
      mergeFolderNames(
        ['archive'],
        ['new-folder'],
        ['hidden-folder'],
        ['selected-folder'],
        ['bulk-target']
      )
    ).toEqual([
      'archive',
      'bulk-target',
      'hidden-folder',
      'new-folder',
      'selected-folder',
    ]);
  });
});
