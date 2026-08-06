import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearTagCorpusCache,
  fetchTagCorpus,
  parseTagCorpusResponse,
} from '@/services/tagCorpusService';

describe('tagCorpusService', () => {
  afterEach(() => {
    clearTagCorpusCache();
    vi.unstubAllGlobals();
  });

  it('parses valid facet entries and ignores malformed entries', () => {
    expect(parseTagCorpusResponse({
      facets: {
        tags: [
          { value: 'portrait', count: 12 },
          { value: 'broken' },
          null,
          { value: 42, count: 3 },
        ],
      },
    })).toEqual([{ value: 'portrait', count: 12 }]);
  });

  it('loads and caches the all-namespace corpus response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ facets: { tags: [{ value: 'portrait', count: 2 }] } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    await expect(fetchTagCorpus(controller.signal)).resolves.toEqual([{ value: 'portrait', count: 2 }]);
    await expect(fetchTagCorpus()).resolves.toEqual([{ value: 'portrait', count: 2 }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/images?namespace=__all__&page=1&pageSize=1',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });
});
