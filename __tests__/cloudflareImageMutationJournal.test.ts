import { beforeEach, describe, expect, it, vi } from 'vitest';

type StoredValue = {
  data: unknown;
  timestamp: number;
  version: number;
};

describe('Cloudflare image mutation journal', () => {
  let store: Map<string, StoredValue>;

  beforeEach(() => {
    vi.resetModules();
    store = new Map();
    vi.doMock('@/server/cacheStorage', () => ({
      getCacheStorage: () => ({
        get: vi.fn(async (key: string) => store.get(key) ?? null),
        set: vi.fn(async (key: string, data: unknown, timestamp = Date.now()) => {
          store.set(key, { data, timestamp, version: 2 });
        }),
        delete: vi.fn(async (key: string) => {
          store.delete(key);
        }),
        exists: vi.fn(async (key: string) => store.has(key)),
      }),
    }));
  });

  it('replays durable upserts and tombstones over a snapshot', async () => {
    const journal = await import('@/server/cloudflareImageMutationJournal');
    await journal.clearCloudflareImageMutationJournal();
    await journal.recordCloudflareImageMutation({
      kind: 'upsert',
      imageId: 'new',
      recordedAt: 10,
      image: {
        id: 'new',
        filename: 'new.jpg',
        uploaded: '2026-01-01T00:00:00.000Z',
        variants: [],
        tags: [],
      },
    });
    await journal.recordCloudflareImageMutation({
      kind: 'delete',
      imageId: 'old',
      recordedAt: 11,
    });

    const mutations = await journal.getCloudflareImageMutations();
    const replayed = journal.applyCloudflareImageMutations([
      {
        id: 'old',
        filename: 'old.jpg',
        uploaded: '2025-01-01T00:00:00.000Z',
        variants: [],
        tags: [],
      },
    ], mutations);

    expect(replayed.map((image) => image.id)).toEqual(['new']);
    expect(store.get('cloudflare-image-mutation-journal')?.data).toHaveLength(2);
  });

  it('does not acknowledge a newer mutation with an older reconciliation result', async () => {
    const journal = await import('@/server/cloudflareImageMutationJournal');
    await journal.clearCloudflareImageMutationJournal();
    const older = {
      kind: 'delete' as const,
      imageId: 'same',
      recordedAt: 10,
    };
    await journal.recordCloudflareImageMutation(older);
    await journal.recordCloudflareImageMutation({
      kind: 'delete',
      imageId: 'same',
      recordedAt: 20,
    });
    await journal.acknowledgeCloudflareImageMutations([older]);

    expect(await journal.getCloudflareImageMutations()).toEqual([
      expect.objectContaining({ imageId: 'same', recordedAt: 20 }),
    ]);
  });
});
