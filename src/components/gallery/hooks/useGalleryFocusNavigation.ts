import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { CanonicalGalleryFocusTarget } from '../focusNavigation';
import type { CloudflareImage } from '../types';

type GalleryServerFocus = {
  assetId: string;
  found: boolean;
  index: number;
  ordinal: number;
  page: number;
  pageSize: number;
  total: number;
} | null;

export const useGalleryFocusNavigation = ({
  initialFocusTargetRef,
  namespace,
  clearFilters,
  clearColorSearch,
  galleryImages,
  filteredImages,
  loading,
  pageIndex,
  serverFocus,
  setCurrentPage,
}: {
  initialFocusTargetRef: MutableRefObject<CanonicalGalleryFocusTarget | null>;
  namespace?: string;
  clearFilters: () => void;
  clearColorSearch: () => void;
  galleryImages: CloudflareImage[];
  filteredImages: CloudflareImage[];
  loading: boolean;
  pageIndex: number;
  serverFocus: GalleryServerFocus;
  setCurrentPage: Dispatch<SetStateAction<number>>;
}) => {
  const [focusedGalleryAssetId, setFocusedGalleryAssetId] = useState<string | null>(null);
  const [focusNotice, setFocusNotice] = useState<string | null>(null);
  const focusCanonicalizedRef = useRef(false);
  const focusAppliedRef = useRef(false);
  // Set true to skip the next refetch that would otherwise be triggered by a
  // currentPage change. Used during focus reconciliation: the server's first
  // response already returned the focus page's data, so when we sync the client
  // currentPage to match serverFocus.page, there's no reason to refetch.
  const focusReconcileSkipRef = useRef(false);

  useEffect(() => {
    const focusTarget = initialFocusTargetRef.current;
    if (!focusTarget) return;
    if (focusCanonicalizedRef.current) return;
    const activeNamespace = namespace ?? '';
    if (focusTarget.namespace !== activeNamespace) return;

    focusCanonicalizedRef.current = true;
    clearFilters();
    clearColorSearch();
    setFocusNotice(
      focusTarget.namespace === '__all__'
        ? 'Locating image in all namespaces; filters were cleared for this focused asset.'
        : 'Locating image in this namespace; filters were cleared for this focused asset.'
    );
  }, [clearColorSearch, clearFilters, initialFocusTargetRef, namespace]);

  useEffect(() => {
    const focusTarget = initialFocusTargetRef.current;
    if (!focusTarget) return;
    if (focusAppliedRef.current) return;
    const activeNamespace = namespace ?? '';
    if (focusTarget.namespace !== activeNamespace) return;
    if (!focusCanonicalizedRef.current) return;
    if (loading) return;
    if (!serverFocus || serverFocus.assetId !== focusTarget.assetId) return;

    if (!serverFocus.found) {
      focusAppliedRef.current = true;
      setFocusNotice('The requested asset could not be placed in gallery order.');
      return;
    }

    // The server already returned the focus page's data in this response.
    // The asset should be present in galleryImages right now. If it isn't,
    // the data the server placed us on is inconsistent with focus metadata --
    // surface that and stop.
    const scopedAsset = galleryImages.find((entry) => entry.id === focusTarget.assetId);
    if (!scopedAsset) {
      focusAppliedRef.current = true;
      setFocusNotice('The requested asset is not available in this gallery scope.');
      return;
    }

    const isOnLoadedPage = filteredImages.some((entry) => entry.id === focusTarget.assetId);
    if (!isOnLoadedPage) {
      focusAppliedRef.current = true;
      setFocusNotice('The requested asset could not be placed in gallery order.');
      return;
    }

    // Sync the client's currentPage to match what the server placed us on,
    // without triggering a refetch -- the data is already loaded. This keeps
    // the pagination indicator honest and lets subsequent navigation start
    // from the focused page.
    const targetPage = serverFocus.page;
    if (pageIndex !== targetPage) {
      focusReconcileSkipRef.current = true;
      setCurrentPage(targetPage);
    }

    focusAppliedRef.current = true;
    setFocusNotice(`Image ${serverFocus.ordinal.toLocaleString()} of ${serverFocus.total.toLocaleString()}`);
    setFocusedGalleryAssetId(focusTarget.assetId);

    // Scroll the focused tile to just under the gallery header, not centered
    // mid-viewport. The card's `scroll-margin-top` (set in ImageCard) provides
    // the offset so the tile sits cleanly under the sticky controls.
    window.requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(
        `[data-gallery-asset-id="${focusTarget.assetId}"]`
      );
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    // Highlight is persistent: it stays until the user navigates away from
    // the focus page or unmounts the gallery. See the page-change effect below.
  }, [filteredImages, galleryImages, initialFocusTargetRef, loading, namespace, pageIndex, serverFocus, setCurrentPage]);

  // Clear the focus highlight when the user navigates to a different page.
  // This makes the highlight feel like an "I just landed here" cue rather than
  // a permanent marker that follows the user through pagination.
  useEffect(() => {
    if (!focusAppliedRef.current) return;
    if (!serverFocus) return;
    if (!focusedGalleryAssetId) return;
    if (pageIndex !== serverFocus.page) {
      setFocusedGalleryAssetId(null);
    }
  }, [pageIndex, serverFocus, focusedGalleryAssetId]);

  return {
    focusedGalleryAssetId,
    focusNotice,
    setFocusNotice,
    focusAppliedRef,
    focusReconcileSkipRef,
  };
};
