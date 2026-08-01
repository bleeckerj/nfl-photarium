import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type StoredCacheValue<T = unknown> = {
  data: T;
  timestamp: number;
  version: number;
};

const ORIGINAL_ENV = { ...process.env };

describe('cloudflareImageCache parent overrides', () => {
  let store: Map<string, StoredCacheValue>;
  let storage: {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    exists: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.resetModules();
    store = new Map();
    storage = {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, data: unknown, timestamp?: number) => {
        store.set(key, {
          data,
          timestamp: timestamp ?? Date.now(),
          version: 2,
        });
      }),
      delete: vi.fn(async (key: string) => {
        store.delete(key);
      }),
      exists: vi.fn(async (key: string) => store.has(key)),
    };

    process.env = { ...ORIGINAL_ENV };
    delete process.env.CLOUDFLARE_CACHE_DISABLED;

    vi.doMock('@/server/cacheStorage', () => ({
      getCacheStorage: () => storage,
    }));
  });

  afterEach(() => {
    vi.doUnmock('@/server/cacheStorage');
    vi.resetModules();
    process.env = ORIGINAL_ENV;
  });

  it('persists a cleared parent override so stale Cloudflare metadata cannot resurrect a detached variant', async () => {
    const {
      clearAllCaches,
      transformApiImageToCached,
      upsertCachedImage,
    } = await import('@/server/cloudflareImageCache');

    await clearAllCaches();

    upsertCachedImage({
      id: 'child',
      filename: 'child.jpg',
      uploaded: '2026-03-01T00:00:00.000Z',
      variants: [],
      tags: [],
      parentId: 'parent-old',
    });

    await vi.waitFor(() => {
      const overrides = store.get('cloudflare-metadata-overrides')?.data as Record<string, { variationParentId?: string }> | undefined;
      expect(overrides?.child?.variationParentId).toBe('parent-old');
    });

    upsertCachedImage({
      id: 'child',
      filename: 'child.jpg',
      uploaded: '2026-03-01T00:00:00.000Z',
      variants: [],
      tags: [],
      parentId: undefined,
    });

    await vi.waitFor(() => {
      const overrides = store.get('cloudflare-metadata-overrides')?.data as Record<string, { variationParentId?: string }> | undefined;
      expect(overrides?.child?.variationParentId).toBe('');
    });

    const transformed = transformApiImageToCached({
      id: 'child',
      filename: 'child.jpg',
      uploaded: '2026-03-01T00:00:00.000Z',
      variants: [],
      meta: { variationParentId: 'parent-old' },
    });

    expect(transformed.parentId).toBeUndefined();

    upsertCachedImage(transformed);

    await vi.waitFor(() => {
      const overrides = store.get('cloudflare-metadata-overrides')?.data as Record<string, { variationParentId?: string }> | undefined;
      expect(overrides?.child?.variationParentId).toBe('');
    });
  });

  it('uses the locally updated folder override while Cloudflare metadata is stale', async () => {
    const {
      clearAllCaches,
      transformApiImageToCached,
      upsertCachedImage,
    } = await import('@/server/cloudflareImageCache');

    await clearAllCaches();

    upsertCachedImage({
      id: 'image-1',
      filename: 'image.jpg',
      uploaded: '2026-03-01T00:00:00.000Z',
      variants: [],
      tags: [],
      folder: 'folder-old',
    });

    upsertCachedImage({
      id: 'image-1',
      filename: 'image.jpg',
      uploaded: '2026-03-01T00:00:00.000Z',
      variants: [],
      tags: [],
      folder: 'folder-new',
    });

    await vi.waitFor(() => {
      const overrides = store.get('cloudflare-metadata-overrides')?.data as Record<string, { folder?: string }> | undefined;
      expect(overrides?.['image-1']?.folder).toBe('folder-new');
    });

    const transformed = transformApiImageToCached({
      id: 'image-1',
      filename: 'image.jpg',
      uploaded: '2026-03-01T00:00:00.000Z',
      variants: [],
      meta: { folder: 'folder-old' },
    });

    expect(transformed.folder).toBe('folder-new');
  });

  it('persists a cleared folder override so stale Cloudflare metadata cannot restore the old folder', async () => {
    const {
      clearAllCaches,
      transformApiImageToCached,
      upsertCachedImage,
    } = await import('@/server/cloudflareImageCache');

    await clearAllCaches();

    upsertCachedImage({
      id: 'image-1',
      filename: 'image.jpg',
      uploaded: '2026-03-01T00:00:00.000Z',
      variants: [],
      tags: [],
      folder: 'folder-old',
    });

    upsertCachedImage({
      id: 'image-1',
      filename: 'image.jpg',
      uploaded: '2026-03-01T00:00:00.000Z',
      variants: [],
      tags: [],
      folder: undefined,
    });

    await vi.waitFor(() => {
      const overrides = store.get('cloudflare-metadata-overrides')?.data as Record<string, { folder?: string }> | undefined;
      expect(overrides?.['image-1']?.folder).toBe('');
    });

    const transformed = transformApiImageToCached({
      id: 'image-1',
      filename: 'image.jpg',
      uploaded: '2026-03-01T00:00:00.000Z',
      variants: [],
      meta: { folder: 'folder-old' },
    });

    expect(transformed.folder).toBeUndefined();
  });

  it('does not bump contentVersion when re-upserting an identical record', async () => {
    const {
      clearAllCaches,
      getCacheStats,
      upsertCachedImage,
    } = await import('@/server/cloudflareImageCache');

    await clearAllCaches();

    const record = {
      id: 'stable',
      filename: 'stable.jpg',
      uploaded: '2026-03-01T00:00:00.000Z',
      variants: ['https://example.com/stable/public'],
      tags: ['keep'],
      size: 1234,
      dominantColors: ['#aabbcc'],
      dimensions: { width: 640, height: 480 },
    };

    await upsertCachedImage({ ...record, tags: [...record.tags] });
    const versionAfterInsert = getCacheStats().contentVersion;

    await upsertCachedImage({
      ...record,
      tags: [...record.tags],
      dominantColors: [...record.dominantColors],
      dimensions: { ...record.dimensions },
    });

    expect(getCacheStats().contentVersion).toBe(versionAfterInsert);
  });

  it('bumps contentVersion when a field actually changes', async () => {
    const {
      clearAllCaches,
      getCacheStats,
      upsertCachedImage,
    } = await import('@/server/cloudflareImageCache');

    await clearAllCaches();

    const record = {
      id: 'changing',
      filename: 'before.jpg',
      uploaded: '2026-03-01T00:00:00.000Z',
      variants: [],
      tags: [],
    };

    await upsertCachedImage(record);
    const versionAfterInsert = getCacheStats().contentVersion;

    await upsertCachedImage({ ...record, filename: 'after.jpg' });
    expect(getCacheStats().contentVersion).toBe(versionAfterInsert + 1);
  });

  it('bumps contentVersion when enrichment discovers a new field', async () => {
    const {
      clearAllCaches,
      getCacheStats,
      upsertCachedImage,
    } = await import('@/server/cloudflareImageCache');

    await clearAllCaches();

    const record = {
      id: 'enriched',
      filename: 'enriched.jpg',
      uploaded: '2026-03-01T00:00:00.000Z',
      variants: [],
      tags: [],
      size: 4321,
    };

    await upsertCachedImage(record);
    const versionAfterInsert = getCacheStats().contentVersion;

    await upsertCachedImage({ ...record, dominantColors: ['#001122'] });
    expect(getCacheStats().contentVersion).toBe(versionAfterInsert + 1);
  });

  it('serves a resident snapshot while stale reconciliation is still running', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'account';
    process.env.CLOUDFLARE_API_TOKEN = 'token';
    process.env.CLOUDFLARE_CACHE_TTL_MS = '1';
    process.env.CLOUDFLARE_SIZE_BACKFILL_DISABLED = 'true';
    const originalFetch = global.fetch;
    let resolveCloudflare: ((response: Response) => void) | undefined;
    global.fetch = vi.fn(() => new Promise<Response>((resolve) => {
      resolveCloudflare = resolve;
    })) as typeof fetch;

    try {
      const {
        clearAllCaches,
        getCachedImages,
      } = await import('@/server/cloudflareImageCache');
      await clearAllCaches();
      store.set('cloudflare-images', {
        data: [{
          id: 'resident',
          filename: 'resident.jpg',
          uploaded: '2026-01-01T00:00:00.000Z',
          variants: [],
          tags: [],
        }],
        timestamp: Date.now() - 10_000,
        version: 2,
      });

      const first = await getCachedImages(false);
      await vi.waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
      const second = await getCachedImages(false);

      expect(first.map((image) => image.id)).toEqual(['resident']);
      expect(second.map((image) => image.id)).toEqual(['resident']);
      expect(
        storage.get.mock.calls.filter(([key]) => key === 'cloudflare-images')
      ).toHaveLength(1);

      resolveCloudflare?.(new Response(JSON.stringify({
        result: { images: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
      await vi.waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(1);
      });
    } finally {
      global.fetch = originalFetch;
    }
  });
});
