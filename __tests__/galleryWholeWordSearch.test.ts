import { describe, expect, it } from 'vitest';
import { filterImagesForGallery, type GalleryImage } from '@/utils/galleryFilter';
import { queryGalleryAssets } from '@/server/galleryQuery';

const image = (id: string, values: Partial<GalleryImage> = {}): GalleryImage => ({
  id, filename: 'sample.jpg', uploaded: '2026-01-01', variants: [], ...values,
});
const fields = ['filename', 'displayName', 'folder', 'description', 'altTag', 'altText', 'promptThis',
  'originalUrl', 'originalUrlNormalized', 'sourceUrl', 'sourceUrlNormalized', 'tags', 'variants', 'searchText'] as const;

describe.each(['client', 'server'] as const)('%s gallery whole-word search', (surface) => {
  const search = (images: GalleryImage[], query = 'Turing') => {
    if (surface === 'client') {
      return filterImagesForGallery(images, {
        selectedFolder: 'all', selectedTag: '', searchTerm: query, onlyCanonical: false,
      }).map((item) => item.id);
    }
    const result = queryGalleryAssets(images, { search: query }, 1, 1, undefined, undefined, {
      extrasSearchTextById: new Map(images.map((item) => [item.id, item.searchText ?? ''])),
    });
    expect(result.total).toBe(result.images.length);
    return result.images.map((item) => item.id);
  };

  it.each(fields)('rejects partial matches in %s', (field) => {
    const value = (text: string) => field === 'tags' || field === 'variants' ? [text] : text;
    expect(search([
      image('partial', { [field]: value('featuring') }),
      image('whole', { [field]: value('Alan Turing.') }),
    ])).toEqual(['whole']);
  });

  it('matches filenames, camel-case display names, and complete source IDs', () => {
    expect(search([image('match', { filename: 'alan_turing.jpg' })])).toEqual(['match']);
    expect(search([image('match', { displayName: 'AlanTuring' })])).toEqual(['match']);
    expect(search([image('1476850850478690358')], '1476850850478690358')).toEqual(['1476850850478690358']);
    expect(search([image('1476850850478690358')], '1476850850')).toEqual([]);
  });

  it('preserves URL searches with different tracking parameters', () => {
    expect(search([image('match', { sourceUrl: 'https://example.com/turing.jpg?ref=old' })],
      'https://example.com/turing.jpg?ref=new')).toEqual(['match']);
  });
});
