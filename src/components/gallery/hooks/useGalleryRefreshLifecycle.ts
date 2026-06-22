import { useEffect, useImperativeHandle, useRef, type ForwardedRef, type MutableRefObject } from 'react';
import type { ImageGalleryRef } from '../types';
import type { GalleryServerPagination } from '../serverState';

type FetchImages = (options?: { silent?: boolean; forceRefresh?: boolean; syncNamespaces?: boolean; firstPage?: boolean }) => Promise<void>;

type UseGalleryRefreshLifecycleOptions = {
  fetchImages: FetchImages;
  imageCount: number;
  loading: boolean;
  perfLoggingEnabled: boolean;
  ref: ForwardedRef<ImageGalleryRef>;
  refreshTrigger?: number;
  resetToFirstPage: (page: number) => void;
  returningFromDetailRef: MutableRefObject<boolean>;
  serverPagination: GalleryServerPagination | null;
};

export function useGalleryRefreshLifecycle({
  fetchImages,
  imageCount,
  loading,
  perfLoggingEnabled,
  ref,
  refreshTrigger,
  resetToFirstPage,
  returningFromDetailRef,
  serverPagination,
}: UseGalleryRefreshLifecycleOptions) {
  const initialLoadStartedAtRef = useRef<number>(typeof performance !== 'undefined' ? performance.now() : Date.now());
  const initialLoadLoggedRef = useRef(false);

  useEffect(() => {
    if (loading || initialLoadLoggedRef.current) return;
    initialLoadLoggedRef.current = true;
    if (!perfLoggingEnabled) return;
    const elapsedMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - initialLoadStartedAtRef.current;
    console.info(
      `[GalleryPerf] initial_render ${Math.round(elapsedMs)}ms (images=${imageCount}, total=${serverPagination?.total ?? imageCount}, returningFromDetail=${returningFromDetailRef.current})`
    );
  }, [imageCount, loading, perfLoggingEnabled, returningFromDetailRef, serverPagination]);

  useImperativeHandle(ref, () => ({
    refreshImages: () => {
      // Newly uploaded assets sort onto the first page; jump there so they are
      // visible even when the user was browsing a later page.
      resetToFirstPage(1);
      return fetchImages({ silent: true, syncNamespaces: true, firstPage: true });
    },
  }));

  useEffect(() => {
    if (refreshTrigger && refreshTrigger > 0) {
      resetToFirstPage(1);
      fetchImages({ silent: true, syncNamespaces: true, firstPage: true });
    }
  }, [refreshTrigger, fetchImages, resetToFirstPage]);
}
