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
});
