import { describe, expect, it } from 'vitest';
import { analyzeGalleryDuplicates, clearGalleryDuplicateAnalysisCache } from '@/server/galleryDuplicateAnalysis';

const hash = 'a'.repeat(64);

describe('gallery duplicate analysis', () => {
  it('returns exact bulk selection sets and page-local ids', async () => {
    clearGalleryDuplicateAnalysisCache();
    const result = await analyzeGalleryDuplicates([
      {
        id: 'old',
        uploaded: '2026-01-01T00:00:00.000Z',
        originalUrlNormalized: 'https://example.com/a.jpg',
        contentHash: hash,
      },
      {
        id: 'new',
        uploaded: '2026-01-02T00:00:00.000Z',
        originalUrlNormalized: 'https://example.com/a.jpg',
        contentHash: hash,
      },
      {
        id: 'unique',
        originalUrlNormalized: 'https://example.com/b.jpg',
        contentHash: 'b'.repeat(64),
      },
    ], {
      catalogVersion: 9,
      scopeKey: 'all',
      pageIds: ['new', 'unique'],
    });

    expect(result).toMatchObject({
      status: 'ready',
      catalogVersion: 9,
      groupCount: 1,
      imageCount: 2,
      pageDuplicateIds: ['new'],
      duplicateIdsExcludingNewest: ['old'],
      duplicateIdsExcludingOldest: ['new'],
    });
  });
});
