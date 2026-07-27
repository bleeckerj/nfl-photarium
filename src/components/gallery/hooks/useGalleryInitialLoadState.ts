import { useRef } from 'react';
import type { CloudflareImage } from '../types';
import { parseCanonicalGalleryFocusFromSearch } from '../focusNavigation';
import {
  createGalleryReturnFilterSignature,
  createGallerySnapshotFilterSignature,
  getFreshGalleryPageSnapshot,
  getFreshGalleryReturnState,
  GALLERY_RETURN_SNAPSHOT_KEY,
  GALLERY_RETURN_TTL_MS,
  saveGalleryPageSnapshot,
  type GalleryPageSnapshot,
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
  page: number;
  filterSignature: string;
  catalogVersion: number | null;
};

type GalleryReturnSnapshotState = {
  namespace?: string;
  savedAt?: number;
  currentPage?: number;
  images?: CloudflareImage[];
};

let galleryWarmCaches: GalleryWarmCacheState[] = [];

export const rememberGalleryWarmCache = (
  namespace: string,
  images: CloudflareImage[],
  options: {
    page?: number;
    filterSignature?: string;
    catalogVersion?: number | null;
  } = {}
) => {
  if (images.length === 0) return;
  const snapshot: GalleryWarmCacheState = {
    namespace,
    images,
    savedAt: Date.now(),
    page: Math.max(1, options.page ?? 1),
    filterSignature: options.filterSignature ?? '',
    catalogVersion: options.catalogVersion ?? null,
  };
  const key = `${snapshot.namespace}\u0000${snapshot.page}\u0000${snapshot.filterSignature}`;
  galleryWarmCaches = [
    snapshot,
    ...galleryWarmCaches.filter(
      (entry) => `${entry.namespace}\u0000${entry.page}\u0000${entry.filterSignature}` !== key
    ),
  ].slice(0, 8);
  saveGalleryPageSnapshot(snapshot);
};

export const rememberGalleryResponseSnapshot = (options: {
  namespace: string;
  images: CloudflareImage[];
  response: Pick<Response, 'headers'>;
  pagination?: { page?: number } | null;
  query: Parameters<typeof createGallerySnapshotFilterSignature>[0] & { page?: number };
}): number | null => {
  const versionHeader = options.response.headers.get('x-photarium-catalog-version');
  const parsedVersion = versionHeader === null ? Number.NaN : Number(versionHeader);
  const catalogVersion = Number.isFinite(parsedVersion) ? parsedVersion : null;
  rememberGalleryWarmCache(options.namespace, options.images, {
    page:
      typeof options.pagination?.page === 'number'
        ? options.pagination.page
        : options.query.page,
    filterSignature: createGallerySnapshotFilterSignature(options.query),
    catalogVersion,
  });
  return catalogVersion;
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
    if (initialFocusTargetRef.current) return true;
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

  const activeNamespace = namespace ?? '';
  const snapshotFilterSignature = (() => {
    const returnFilters = initialGalleryReturnStateRef.current?.filters;
    if (returnFilters) {
      return createGalleryReturnFilterSignature(returnFilters);
    }
    if (!initialFocusTargetRef.current) return undefined;
    const preferences = storedPreferencesRef.current;
    return createGallerySnapshotFilterSignature({
      pageSize: preferences.pageSize,
      search: preferences.searchTerm,
      folder: preferences.selectedFolder,
      tag: preferences.selectedTag,
      onlyCanonical: preferences.onlyCanonical,
      onlyWithVariants: preferences.onlyWithVariants,
      favorites: preferences.showFavoritesOnly,
      duplicates: preferences.showDuplicatesOnly,
      comfy: preferences.showComfyOnly,
      embedding: preferences.embeddingFilter,
      aspectRatioFilters: preferences.aspectRatioFilters,
      dateFilter: preferences.dateFilter,
      hiddenFolders: preferences.hiddenFolders,
      hiddenTags: preferences.hiddenTags,
      hiddenNamespaces: preferences.hiddenNamespaces,
      showMotionAssetsOnly: preferences.showMotionAssetsOnly,
    });
  })();
  const snapshotPage = initialFocusTargetRef.current
    ? undefined
    : initialGalleryReturnStateRef.current?.currentPage;
  const snapshotAssetId = initialFocusTargetRef.current?.assetId;

  const initialWarmImages = (() => {
    if (!initialReturningFromDetail) {
      return [] as CloudflareImage[];
    }
    const warm = galleryWarmCaches.find((entry) => (
      entry.namespace === activeNamespace
      && (snapshotPage === undefined || entry.page === snapshotPage)
      && (snapshotFilterSignature === undefined || entry.filterSignature === snapshotFilterSignature)
      && (!snapshotAssetId || entry.images.some((image) => image.id === snapshotAssetId))
      && Date.now() - entry.savedAt < GALLERY_RETURN_TTL_MS
    ));
    return warm?.images ?? [];
  })();

  const initialSnapshotImages = (() => {
    if (!initialReturningFromDetail || typeof window === 'undefined') {
      return [] as CloudflareImage[];
    }
    const snapshot = getFreshGalleryPageSnapshot<CloudflareImage>({
      namespace: activeNamespace,
      page: snapshotPage,
      filterSignature: snapshotFilterSignature,
      assetId: snapshotAssetId,
    });
    if (snapshot) {
      rememberGalleryWarmCache(activeNamespace, snapshot.images, snapshot);
      return snapshot.images;
    }

    // One-version compatibility fallback. New writes use the LRU above.
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
        const legacySnapshot: GalleryPageSnapshot<CloudflareImage> = {
          namespace: activeNamespace,
          images: snapshotImages,
          savedAt: savedAt || Date.now(),
          page: typeof parsed.currentPage === 'number' ? parsed.currentPage : 1,
          filterSignature: snapshotFilterSignature ?? '',
          catalogVersion: null,
        };
        rememberGalleryWarmCache(activeNamespace, snapshotImages, legacySnapshot);
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
