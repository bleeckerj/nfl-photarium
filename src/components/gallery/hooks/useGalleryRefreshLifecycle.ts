import { useEffect, useImperativeHandle, useRef, type ForwardedRef, type MutableRefObject } from 'react';
import type { ImageGalleryRef } from '../types';
import type { GalleryServerPagination } from '../serverState';

type FetchImages = (options?: { silent?: boolean; forceRefresh?: boolean; syncNamespaces?: boolean }) => Promise<void>;

type UseGalleryRefreshLifecycleOptions = {
  fetchImages: FetchImages;
  imageCount: number;
  loading: boolean;
  perfLoggingEnabled: boolean;
  ref: ForwardedRef<ImageGalleryRef>;
  refreshTrigger?: number;
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
    refreshImages: () => fetchImages({ silent: true, syncNamespaces: true }),
  }));

  useEffect(() => {
    if (refreshTrigger && refreshTrigger > 0) {
      fetchImages({ silent: true, syncNamespaces: true });
    }
  }, [refreshTrigger, fetchImages]);
}
