import { useCallback, useEffect, useRef, useState } from 'react';
import type { GallerySemanticSearchRef } from '../GallerySemanticSearch';

export function useGalleryControlsVisibility(initialVisible: boolean) {
  const [controlsVisiblePreference, setControlsVisiblePreference] = useState(initialVisible);
  const [galleryControlsVisible, setGalleryControlsVisible] = useState(initialVisible);
  const [pendingSemanticSearchReveal, setPendingSemanticSearchReveal] = useState(false);
  const semanticSearchRef = useRef<GallerySemanticSearchRef | null>(null);

  const applyGalleryControlsVisibility = useCallback((controlsVisible: boolean) => {
    setGalleryControlsVisible((prev) => (prev === controlsVisible ? prev : controlsVisible));
  }, []);

  const toggleGalleryControls = useCallback(() => {
    const shouldShow = !galleryControlsVisible;
    setControlsVisiblePreference(shouldShow);
    applyGalleryControlsVisibility(shouldShow);
  }, [applyGalleryControlsVisibility, galleryControlsVisible]);

  const openSemanticSearch = useCallback(() => {
    setControlsVisiblePreference(true);
    applyGalleryControlsVisibility(true);
    setPendingSemanticSearchReveal(true);
  }, [applyGalleryControlsVisibility]);

  useEffect(() => {
    if (!pendingSemanticSearchReveal || !galleryControlsVisible) return;

    let secondFrameId: number | null = null;
    const frameId = window.requestAnimationFrame(() => {
      secondFrameId = window.requestAnimationFrame(() => {
        semanticSearchRef.current?.reveal();
        setPendingSemanticSearchReveal(false);
      });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      if (secondFrameId !== null) {
        window.cancelAnimationFrame(secondFrameId);
      }
    };
  }, [galleryControlsVisible, pendingSemanticSearchReveal]);

  useEffect(() => {
    if (galleryControlsVisible) return;
    setPendingSemanticSearchReveal(false);
    semanticSearchRef.current?.collapse();
  }, [galleryControlsVisible]);

  return {
    controlsVisiblePreference,
    galleryControlsVisible,
    openSemanticSearch,
    semanticSearchRef,
    toggleGalleryControls,
  };
}
