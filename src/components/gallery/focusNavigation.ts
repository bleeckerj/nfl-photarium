export const GALLERY_NAMESPACE_QUERY_PARAM = 'gns';
export const GALLERY_FOCUS_QUERY_PARAM = 'focus';

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
