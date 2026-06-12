import { useEffect, useRef, type MutableRefObject } from 'react';
import type { NormalizedGalleryReturnState } from '../returnState';
import type { GalleryServerFocus } from '../serverState';
import type { AspectRatioClass } from '../types';

type FetchImages = (options?: { silent?: boolean; forceRefresh?: boolean; syncNamespaces?: boolean }) => Promise<void>;

type InitialGalleryReturnStateRef = MutableRefObject<NormalizedGalleryReturnState | null>;

type UseGalleryNamespaceLifecycleOptions = {
  abortControllerRef: MutableRefObject<AbortController | null>;
  deferInitialFetchRef: MutableRefObject<boolean>;
  fetchImages: FetchImages;
  initialGalleryReturnStateRef: InitialGalleryReturnStateRef;
  initialSilentFetchRef: MutableRefObject<boolean>;
  namespace?: string;
  perfLoggingEnabled: boolean;
  requestedPromptIdsRef: MutableRefObject<Map<string, number>>;
  setAspectRatioFilters: (value: AspectRatioClass[]) => void;
  setOnlyCanonical: (value: boolean) => void;
  setPromptThisMap: (value: Record<string, string | null>) => void;
  setSearchTerm: (value: string) => void;
  setSelectedFolder: (value: string) => void;
  setSelectedTag: (value: string) => void;
  setServerFocus: (value: GalleryServerFocus) => void;
  setShowMotionAssetsOnly: (value: boolean) => void;
  setVideoLimitOverride: (value: number | null) => void;
  setVideoMeta: (value: null) => void;
  setVideoResultsNotice: (value: string | null) => void;
};

export function useGalleryNamespaceLifecycle({
  abortControllerRef,
  deferInitialFetchRef,
  fetchImages,
  initialGalleryReturnStateRef,
  initialSilentFetchRef,
  namespace,
  perfLoggingEnabled,
  requestedPromptIdsRef,
  setAspectRatioFilters,
  setOnlyCanonical,
  setPromptThisMap,
  setSearchTerm,
  setSelectedFolder,
  setSelectedTag,
  setServerFocus,
  setShowMotionAssetsOnly,
  setVideoLimitOverride,
  setVideoMeta,
  setVideoResultsNotice,
}: UseGalleryNamespaceLifecycleOptions) {
  const prevNamespaceRef = useRef(namespace);
  const pendingReturnNamespaceRef = useRef(
    Boolean(
      initialGalleryReturnStateRef.current &&
      initialGalleryReturnStateRef.current.namespace !== (namespace ?? '')
    )
  );

  useEffect(() => {
    if (prevNamespaceRef.current !== namespace) {
      const restoreNamespace = initialGalleryReturnStateRef.current?.namespace ?? '';
      const shouldPreserveRestoredFilters =
        pendingReturnNamespaceRef.current && restoreNamespace === (namespace ?? '');

      if (!shouldPreserveRestoredFilters) {
        setSelectedFolder('all');
        setSelectedTag('');
        setSearchTerm('');
        setOnlyCanonical(false);
        setShowMotionAssetsOnly(false);
        setAspectRatioFilters([]);
      } else {
        pendingReturnNamespaceRef.current = false;
      }
      setPromptThisMap({});
      setVideoLimitOverride(null);
      setVideoMeta(null);
      setServerFocus(null);
      setVideoResultsNotice(null);
      requestedPromptIdsRef.current.clear();
      prevNamespaceRef.current = namespace;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    if (deferInitialFetchRef.current) {
      deferInitialFetchRef.current = false;
      if (perfLoggingEnabled) {
        console.info('[GalleryPerf] restored snapshot; refreshing current gallery page');
      }
    }
    const silent = initialSilentFetchRef.current;
    initialSilentFetchRef.current = false;
    fetchImages({ silent });
  }, [
    abortControllerRef,
    deferInitialFetchRef,
    fetchImages,
    initialGalleryReturnStateRef,
    initialSilentFetchRef,
    namespace,
    perfLoggingEnabled,
    requestedPromptIdsRef,
    setAspectRatioFilters,
    setOnlyCanonical,
    setPromptThisMap,
    setSearchTerm,
    setSelectedFolder,
    setSelectedTag,
    setServerFocus,
    setShowMotionAssetsOnly,
    setVideoLimitOverride,
    setVideoMeta,
    setVideoResultsNotice,
  ]);
}
