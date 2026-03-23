import { describe, expect, it } from 'vitest';

describe('flickr ingest mapping helpers', async () => {
  const mapping = await import('../scripts/flickr-ingest/mapping.mjs');

  it('prefers original sources when available', () => {
    const selected = mapping.chooseBestPhotoSource({
      id: '1',
      urlMap: {
        url_o: 'https://example.com/original.jpg',
        url_l: 'https://example.com/large.jpg',
      },
    });

    expect(selected).toEqual(
      expect.objectContaining({
        url: 'https://example.com/original.jpg',
        originalAvailable: true,
      })
    );
  });

  it('falls back to the largest size when no original is present', () => {
    const selected = mapping.chooseBestPhotoSource(
      {
        id: '2',
        urlMap: {},
      },
      [
        { label: 'Medium', width: 640, height: 480, source: 'https://example.com/medium.jpg', media: 'photo' },
        { label: 'Large', width: 2048, height: 1536, source: 'https://example.com/large.jpg', media: 'photo' },
      ]
    );

    expect(selected).toEqual(
      expect.objectContaining({
        url: 'https://example.com/large.jpg',
        originalAvailable: false,
      })
    );
  });

  it('maps folders predictably from selector and album context', () => {
    expect(
      mapping.determineFolder({
        selector: 'album',
        selectedAlbumTitle: 'Road Trip',
        albumTitles: ['Road Trip', 'Favorites'],
      })
    ).toBe('Road Trip');

    expect(
      mapping.determineFolder({
        selector: 'all',
        selectedAlbumTitle: undefined,
        albumTitles: ['Zoo', 'Archive'],
      })
    ).toBe('Archive');
  });
});
