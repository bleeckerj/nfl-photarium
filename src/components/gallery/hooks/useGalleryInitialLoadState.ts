import { useRef } from 'react';
import type { CloudflareImage } from '../types';
import { parseCanonicalGalleryFocusFromSearch } from '../focusNavigation';
import {
  getFreshGalleryReturnState,
  GALLERY_RETURN_SNAPSHOT_KEY,
  GALLERY_RETURN_TTL_MS,
  type NormalizedGalleryReturnState,
} from '../returnState';
import { getStoredPreferences } from '../storedPreferences';

type GalleryUrlSearchParams = {
  toString(): string;
} | null;

type GalleryWarmCacheState = {
  namespace: string;
  images: CloudflareImage[];
  savedAt: number;
};

type GalleryReturnSnapshotState = {
  namespace?: string;
  savedAt?: number;
  currentPage?: number;
  images?: CloudflareImage[];
};

let galleryWarmCache: GalleryWarmCacheState | null = null;

export const rememberGalleryWarmCache = (namespace: string, images: CloudflareImage[]) => {
  galleryWarmCache = {
    namespace,
    images,
    savedAt: Date.now(),
  };
};

export const useGalleryInitialLoadState = ({
  namespace,
  galleryUrlSearchParams,
}: {
  namespace?: string;
  galleryUrlSearchParams: GalleryUrlSearchParams;
}) => {
  // React's URL hook is reliably in sync with the rendered route; window.location
  // can lag a tick during client-side navigation in this app.
  const initialFocusTargetRef = useRef(
    (() => {
      const fromHook = galleryUrlSearchParams ? galleryUrlSearchParams.toString() : '';
      const fromHookTarget = fromHook ? parseCanonicalGalleryFocusFromSearch(`?${fromHook}`) : null;
      if (fromHookTarget) return fromHookTarget;
      if (typeof window === 'undefined') return null;
      return parseCanonicalGalleryFocusFromSearch(window.location.search);
    })()
  );
  const initialGalleryReturnStateRef = useRef<NormalizedGalleryReturnState | null>(
    initialFocusTargetRef.current ? null : getFreshGalleryReturnState()
  );
  const storedPreferencesRef = useRef(
    getStoredPreferences(namespace, initialGalleryReturnStateRef.current, {
      neutralizeFilters: Boolean(initialFocusTargetRef.current),
    })
  );

  const initialReturningFromDetail = (() => {
    if (initialFocusTargetRef.current) return false;
    if (initialGalleryReturnStateRef.current) return true;
    if (typeof window === 'undefined') return false;
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('gpage')) return true;
    } catch {
      // ignore
    }
    return false;
  })();

  const initialWarmImages = (() => {
    if (!initialReturningFromDetail) {
      return [] as CloudflareImage[];
    }
    const activeNamespace = namespace ?? '';
    if (!galleryWarmCache) {
      return [] as CloudflareImage[];
    }
    if (galleryWarmCache.namespace !== activeNamespace) {
      return [] as CloudflareImage[];
    }
    if (Date.now() - galleryWarmCache.savedAt > GALLERY_RETURN_TTL_MS) {
      return [] as CloudflareImage[];
    }
    return galleryWarmCache.images;
  })();

  const initialSnapshotImages = (() => {
    if (!initialReturningFromDetail || typeof window === 'undefined') {
      return [] as CloudflareImage[];
    }
    const activeNamespace = namespace ?? '';
    try {
      const rawSnapshot = window.sessionStorage.getItem(GALLERY_RETURN_SNAPSHOT_KEY);
      if (!rawSnapshot) {
        return [] as CloudflareImage[];
      }
      const parsed = JSON.parse(rawSnapshot) as GalleryReturnSnapshotState;
      const savedNamespace = typeof parsed?.namespace === 'string' ? parsed.namespace : '';
      const savedAt = typeof parsed?.savedAt === 'number' ? parsed.savedAt : 0;
      const freshEnough = !savedAt || Date.now() - savedAt < GALLERY_RETURN_TTL_MS;
      if (!freshEnough || savedNamespace !== activeNamespace || !Array.isArray(parsed?.images)) {
        return [] as CloudflareImage[];
      }
      const snapshotImages = parsed.images.filter(
        (image): image is CloudflareImage => Boolean(image) && typeof image.id === 'string'
      );
      if (snapshotImages.length > 0) {
        galleryWarmCache = {
          namespace: activeNamespace,
          images: snapshotImages,
          savedAt: savedAt || Date.now(),
        };
      }
      return snapshotImages;
    } catch {
      return [] as CloudflareImage[];
    }
  })();

  return {
    initialFocusTargetRef,
    initialGalleryReturnStateRef,
    storedPreferencesRef,
    returningFromDetailRef: useRef(initialReturningFromDetail),
    initialSilentFetchRef: useRef(initialWarmImages.length > 0 || initialSnapshotImages.length > 0),
    deferInitialFetchRef: useRef(initialReturningFromDetail && initialSnapshotImages.length > 0),
    initialImages: initialSnapshotImages.length > 0 ? initialSnapshotImages : initialWarmImages,
    initialLoading: initialWarmImages.length === 0 && initialSnapshotImages.length === 0,
  };
};
