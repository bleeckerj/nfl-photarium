import { describe, expect, it, vi } from 'vitest';

describe('Flickr ingest selection', async () => {
  const { collectSelectedPhotos, formatCompletionProgress, formatPhotoProgress } = await import('../scripts/flickr-ingest/run.mjs');

  function photo(id: number, lastUpdate = '123') {
    return { id: String(id), lastUpdate, title: `Photo ${id}` };
  }

  function clientWithPhotos(photos: Array<ReturnType<typeof photo>>) {
    return {
      async *listAllUserPhotos() {
        yield { page: 1, totalPages: 1, totalItems: photos.length, items: photos };
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
    expect(result.accountProgressByPhotoId.get('26')).toEqual({ position: 26, total: 50 });
    expect(result.accountProgressByPhotoId.get('50')).toEqual({ position: 50, total: 50 });
    expect(result.accountTotal).toBe(50);
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

  it('formats account and tranche progress with grouped totals', () => {
    expect(formatPhotoProgress({
      index: 0,
      trancheSize: 25,
      completionProgress: { completed: 25, total: 3291 },
    })).toBe('[25/3,266/3,291 complete/left/total] [1/25 tranche]');
  });

  it('formats completed and remaining account totals', () => {
    expect(formatCompletionProgress(51, 3291)).toBe('[51/3,240/3,291 complete/left/total]');
  });
});
