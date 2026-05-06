import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildGalleryImagesUrl,
  getDefaultStoredPreferences,
  getStoredPreferences,
} from '@/components/ImageGallery';
import {
  getFreshGalleryReturnState,
  saveGalleryReturnState,
} from '@/components/gallery/returnState';

type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

const createStorage = (): StorageLike => {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
};

const installWindow = (search = '') => {
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  vi.stubGlobal('window', {
    localStorage,
    sessionStorage,
    location: {
      search,
    },
  });
  return { localStorage, sessionStorage };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ImageGallery motion assets helpers', () => {
  it('adds mediaFilter=animated only when motion assets are enabled', () => {
    expect(
      buildGalleryImagesUrl({
        namespace: 'studio',
        includeExtrasForGallery: true,
        showMotionAssetsOnly: true,
      })
    ).toBe('/api/images?namespace=studio&includeExtras=1&mediaFilter=animated');

    expect(
      buildGalleryImagesUrl({
        namespace: 'studio',
        includeExtrasForGallery: true,
        showMotionAssetsOnly: false,
      })
    ).toBe('/api/images?namespace=studio&includeExtras=1');
  });

  it('adds server-backed gallery pagination and filter params', () => {
    expect(
      buildGalleryImagesUrl({
        namespace: 'studio',
        serverQuery: {
          page: 2,
          pageSize: 60,
          search: 'blue chair',
          folder: 'editorial',
          tag: 'hero',
          onlyCanonical: true,
          onlyWithVariants: true,
          favorites: true,
          duplicates: true,
          comfy: true,
          embedding: 'missing-any',
          aspectRatioFilters: ['horizontal'],
          dateFilter: { startDate: '2026-01-01', endDate: '2026-01-31' },
          hiddenFolders: ['Archive'],
          hiddenTags: ['private'],
          showMotionAssetsOnly: false,
        },
      })
    ).toBe(
      '/api/images?namespace=studio&page=2&pageSize=60&search=blue+chair&folder=editorial&tag=hero&onlyCanonical=1&onlyWithVariants=1&favorites=1&duplicates=1&comfy=1&embedding=missing-any&aspectRatioClasses=horizontal&dateStart=2026-01-01&dateEnd=2026-01-31&hiddenFolders=Archive&hiddenTags=private'
    );
  });

  it('restores the stored motion-assets preference from localStorage', () => {
    const { localStorage } = installWindow();
    localStorage.setItem(
      'galleryPreferences',
      JSON.stringify({
        ...getDefaultStoredPreferences(),
        showMotionAssetsOnly: true,
      })
    );

    const prefs = getStoredPreferences('studio', null);

    expect(prefs.showMotionAssetsOnly).toBe(true);
  });

  it('restores the motion-assets filter from gallery return state', () => {
    installWindow();
    saveGalleryReturnState({
      namespace: 'studio',
      savedAt: Date.now(),
      scrollY: 0,
      selectedImageId: 'img-1',
      resultIds: ['img-1'],
      resultAssets: [{ id: 'img-1', assetType: 'image' }],
      filters: {
        searchTerm: '',
        colorSearchHex: null,
        selectedFolder: 'all',
        selectedTag: '',
        onlyCanonical: false,
        onlyWithVariants: false,
        showMotionAssetsOnly: true,
        showDuplicatesOnly: false,
        showBrokenOnly: false,
        showComfyOnly: false,
        embeddingFilter: 'none',
        aspectRatioFilters: [],
        dateFilter: null,
        hiddenFolders: [],
        hiddenTags: [],
        pageSize: 30,
        currentPage: 1,
      },
    });

    const restoredState = getFreshGalleryReturnState('studio');
    const prefs = getStoredPreferences('studio', restoredState);

    expect(restoredState?.filters?.showMotionAssetsOnly).toBe(true);
    expect(prefs.showMotionAssetsOnly).toBe(true);
  });
});
