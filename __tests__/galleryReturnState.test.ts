import { afterEach, describe, expect, it } from 'vitest';

import {
  DETAIL_ASSET_SEED_KEY,
  getFreshDetailAssetSeed,
  saveDetailAssetSeed,
} from '@/components/gallery/returnState';

const installSessionStorage = () => {
  const store = new Map<string, string>();
  const sessionStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { sessionStorage },
  });
  return sessionStorage;
};

describe('detail asset seed return state', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window');
  });

  it('saves and restores a fresh matching detail seed', () => {
    installSessionStorage();
    const now = 1_700_000_000_000;
    const asset = {
      id: 'asset-1',
      assetType: 'image' as const,
      filename: 'asset.jpg',
      uploaded: '2026-05-01T00:00:00.000Z',
    };

    saveDetailAssetSeed(asset, 'cf-workflow', now);

    expect(
      getFreshDetailAssetSeed<typeof asset>({
        id: 'asset-1',
        assetType: 'image',
        namespace: 'cf-workflow',
        now: now + 1000,
      })?.asset
    ).toEqual(asset);
  });

  it('rejects expired seeds', () => {
    installSessionStorage();
    const now = 1_700_000_000_000;
    saveDetailAssetSeed({ id: 'asset-1', assetType: 'image' as const }, '', now);

    expect(
      getFreshDetailAssetSeed({
        id: 'asset-1',
        assetType: 'image',
        namespace: '',
        now: now + 10 * 60 * 1000 + 1,
      })
    ).toBeNull();
  });

  it('rejects id, type, and namespace mismatches', () => {
    const sessionStorage = installSessionStorage();
    const now = 1_700_000_000_000;
    saveDetailAssetSeed({ id: 'asset-1', assetType: 'video' as const }, 'videos', now);

    expect(getFreshDetailAssetSeed({ id: 'asset-2', assetType: 'video', namespace: 'videos', now })).toBeNull();
    expect(getFreshDetailAssetSeed({ id: 'asset-1', assetType: 'image', namespace: 'videos', now })).toBeNull();
    expect(getFreshDetailAssetSeed({ id: 'asset-1', assetType: 'video', namespace: 'images', now })).toBeNull();

    expect(sessionStorage.getItem(DETAIL_ASSET_SEED_KEY)).toContain('asset-1');
  });
});
