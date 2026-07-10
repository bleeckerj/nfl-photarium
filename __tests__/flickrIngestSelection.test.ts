import { describe, expect, it, vi } from 'vitest';

describe('Flickr ingest selection', async () => {
  const { collectSelectedPhotos } = await import('../scripts/flickr-ingest/run.mjs');

  function photo(id: number, lastUpdate = '123') {
    return { id: String(id), lastUpdate, title: `Photo ${id}` };
  }

  function clientWithPhotos(photos: Array<ReturnType<typeof photo>>) {
    return {
      async *listAllUserPhotos() {
        yield { page: 1, totalPages: 1, items: photos };
      },
    };
  }

  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
  };

  it('applies the limit after filtering unchanged checkpoint successes', async () => {
    const photos = Array.from({ length: 50 }, (_, index) => photo(index + 1));
    const entries = Object.fromEntries(
      photos.slice(0, 25).map((item) => [
        item.id,
        { status: 'uploaded', flickrLastUpdate: item.lastUpdate },
      ]),
    );

    const result = await collectSelectedPhotos({
      client: clientWithPhotos(photos),
      authProfile: { userId: 'user-id' },
      options: { selector: 'all', limit: 25, resume: true },
      logger,
      checkpoint: { entries },
    });

    expect(result.selected.map((item) => item.id)).toEqual(
      Array.from({ length: 25 }, (_, index) => String(index + 26)),
    );
  });

  it('keeps changed checkpoint successes eligible', async () => {
    const result = await collectSelectedPhotos({
      client: clientWithPhotos([photo(1, 'new'), photo(2, 'same')]),
      authProfile: { userId: 'user-id' },
      options: { selector: 'all', limit: 1, resume: true },
      logger,
      checkpoint: {
        entries: {
          '1': { status: 'uploaded', flickrLastUpdate: 'old' },
          '2': { status: 'uploaded', flickrLastUpdate: 'same' },
        },
      },
    });

    expect(result.selected.map((item) => item.id)).toEqual(['1']);
  });
});
