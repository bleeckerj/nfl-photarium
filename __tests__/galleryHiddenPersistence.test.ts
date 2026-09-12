/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useGalleryFilters } from '@/components/gallery/hooks/useGalleryFilters';
import { loadHiddenFolders, loadHiddenNamespaces } from '@/components/gallery/storage';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type TestStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  clear: () => void;
};

const installStorage = (): TestStorage => {
  const values = new Map<string, string>();
  const storage: TestStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
  window.scrollTo = () => undefined;
  return storage;
};

const image = {
  id: 'visible-image',
  filename: 'visible-image.jpg',
  uploaded: '2026-01-01T00:00:00.000Z',
  variants: [],
};

const initialPreferences = {
  selectedFolder: 'all',
  selectedTag: '',
  searchTerm: 'temporary-search',
  onlyCanonical: true,
  respectAspectRatio: true,
  onlyWithVariants: true,
  showMotionAssetsOnly: true,
  showFavoritesOnly: true,
  showDuplicatesOnly: true,
  showBrokenOnly: true,
  showComfyOnly: true,
  embeddingFilter: 'missing-any' as const,
  aspectRatioFilters: ['horizontal'] as const,
  dateFilter: null,
  hiddenFolders: ['archive'],
  hiddenTags: ['private'],
  hiddenNamespaces: ['cf-flickr'],
  pageSize: 30,
  currentPage: 4,
};

describe('gallery hidden visibility persistence', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  let latest: ReturnType<typeof useGalleryFilters> | null = null;
  let storage: TestStorage | undefined;

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
      root = undefined;
    }
    container?.remove();
    container = undefined;
    latest = null;
    storage?.clear();
    storage = undefined;
  });

  it('clears ordinary filters without clearing durable hidden visibility', async () => {
    storage = installStorage();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        React.createElement(function Harness() {
          latest = useGalleryFilters({
            images: [image],
            serverPagination: null,
            initialPreferences,
            brokenImageIds: new Set(),
          });
          return null;
        })
      );
    });

    await act(async () => latest?.clearFilters());

    expect(latest?.searchTerm).toBe('');
    expect(latest?.onlyCanonical).toBe(false);
    expect(latest?.hiddenFolders).toEqual(['archive']);
    expect(latest?.hiddenTags).toEqual(['private']);
    expect(latest?.hiddenNamespaces).toEqual(['cf-flickr']);
    expect(latest?.hasActiveFilters).toBe(false);
    expect(JSON.parse(window.localStorage.getItem('galleryHiddenNamespaces') ?? 'null')).toEqual(['cf-flickr']);
  });

  it('removes hidden namespaces only through explicit visibility operations', async () => {
    storage = installStorage();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        React.createElement(function Harness() {
          latest = useGalleryFilters({
            images: [image],
            serverPagination: null,
            initialPreferences: {
              ...initialPreferences,
              hiddenNamespaces: ['cf-flickr', 'studio'],
            },
            brokenImageIds: new Set(),
          });
          return null;
        })
      );
    });

    await act(async () => latest?.unhideNamespaceByName('cf-flickr'));
    expect(latest?.hiddenNamespaces).toEqual(['studio']);
    expect(JSON.parse(window.localStorage.getItem('galleryHiddenNamespaces') ?? 'null')).toEqual(['studio']);

    await act(async () => latest?.clearHiddenNamespaces());
    expect(latest?.hiddenNamespaces).toEqual([]);
    expect(JSON.parse(window.localStorage.getItem('galleryHiddenNamespaces') ?? 'null')).toEqual([]);
  });

  it('repairs legacy namespace entries that were stored in the hidden-folder list', () => {
    storage = installStorage();
    storage.setItem(
      'galleryHiddenFolders',
      JSON.stringify(['archive', 'namespace cf-exports-for-mail'])
    );
    storage.setItem('galleryHiddenNamespaces', JSON.stringify([]));

    expect(loadHiddenFolders()).toEqual(['archive']);
    expect(loadHiddenNamespaces()).toEqual(['cf-exports-for-mail']);
  });

  it('repairs malformed hidden-folder state supplied by a stale session snapshot', async () => {
    storage = installStorage();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        React.createElement(function Harness() {
          latest = useGalleryFilters({
            images: [image],
            serverPagination: null,
            initialPreferences: {
              ...initialPreferences,
              hiddenFolders: ['namespace cf-exports-for-mail'],
              hiddenNamespaces: [],
            },
            brokenImageIds: new Set(),
          });
          return null;
        })
      );
    });

    expect(latest?.hiddenFolders).toEqual([]);
    expect(latest?.hiddenNamespaces).toEqual(['cf-exports-for-mail']);
  });

  it('resets pagination in the same update as an aspect filter change', async () => {
    storage = installStorage();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        React.createElement(function Harness() {
          latest = useGalleryFilters({
            images: [image],
            serverPagination: {
              page: 4,
              pageSize: 30,
              total: 300,
              totalPages: 10,
            },
            initialPreferences,
            brokenImageIds: new Set(),
          });
          return null;
        })
      );
    });

    expect(latest?.currentPage).toBe(4);
    await act(async () => latest?.setAspectRatioFilters(['vertical']));

    expect(latest?.aspectRatioFilters).toEqual(['vertical']);
    expect(latest?.currentPage).toBe(1);
  });
});
