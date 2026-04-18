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
