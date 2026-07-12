export const GALLERY_NAMESPACE_QUERY_PARAM = 'gns';
export const GALLERY_FOCUS_QUERY_PARAM = 'focus';
export const GALLERY_NAMESPACE_STORAGE_KEY = 'imageNamespace';
const GALLERY_PREFERENCES_STORAGE_KEY = 'galleryPreferences';

/**
 * Wipe the persisted gallery `currentPage` (and any active filters) so that
 * a focus navigation always starts from a clean pagination/filter baseline.
 * Defensive: even if the gallery's own focus-mode neutralization fails for
 * timing reasons, the stored prefs themselves no longer point at a stale page.
 */
export const resetGalleryPreferencesForFocus = () => {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(GALLERY_PREFERENCES_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const reset = {
      ...(parsed && typeof parsed === 'object' ? parsed : {}),
      currentPage: 1,
      searchTerm: '',
      selectedFolder: 'all',
      selectedTag: '',
      onlyCanonical: false,
      onlyWithVariants: false,
      showMotionAssetsOnly: false,
      showFavoritesOnly: false,
      showComfyOnly: false,
      showDuplicatesOnly: false,
      showBrokenOnly: false,
      embeddingFilter: 'none',
      aspectRatioFilters: [],
      hiddenFolders: [],
      hiddenTags: [],
      hiddenNamespaces: [],
      dateFilter: null,
    };
    window.localStorage.setItem(GALLERY_PREFERENCES_STORAGE_KEY, JSON.stringify(reset));
  } catch {
    // best effort; if storage is unavailable, ignore
  }
};

export type CanonicalGalleryFocusTarget = {
  assetId: string;
  namespace: string;
};

const normalizeSearch = (search: string) => (search.startsWith('?') ? search.slice(1) : search);

export const parseGalleryNamespaceFromSearch = (search: string): string | undefined => {
  if (!search) return undefined;
  const params = new URLSearchParams(normalizeSearch(search));
  if (!params.has(GALLERY_NAMESPACE_QUERY_PARAM)) {
    return undefined;
  }
  return params.get(GALLERY_NAMESPACE_QUERY_PARAM) ?? '';
};

export const parseCanonicalGalleryFocusFromSearch = (
  search: string
): CanonicalGalleryFocusTarget | null => {
  if (!search) return null;
  const params = new URLSearchParams(normalizeSearch(search));
  const assetId = params.get(GALLERY_FOCUS_QUERY_PARAM)?.trim();
  if (!assetId) {
    return null;
  }

  return {
    assetId,
    namespace: parseGalleryNamespaceFromSearch(search) ?? '',
  };
};

export const buildCanonicalGalleryHref = ({
  assetId,
  namespace,
}: {
  assetId: string;
  namespace?: string | null;
}) => {
  const normalizedAssetId = assetId.trim();
  if (!normalizedAssetId) {
    return '/';
  }

  const params = new URLSearchParams();
  params.set(GALLERY_NAMESPACE_QUERY_PARAM, typeof namespace === 'string' ? namespace : '');
  params.set(GALLERY_FOCUS_QUERY_PARAM, normalizedAssetId);
  return `/?${params.toString()}`;
};
