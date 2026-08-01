import { useEffect, useLayoutEffect, type MutableRefObject, type RefObject } from 'react';
import { clearGalleryReturnState, GALLERY_RETURN_SNAPSHOT_KEY } from '../returnState';
import type { NormalizedGalleryReturnState } from '../returnState';

type UseGalleryReturnNavigationOptions = {
  initialGalleryReturnStateRef:
    | RefObject<NormalizedGalleryReturnState | null>
    | MutableRefObject<NormalizedGalleryReturnState | null>;
  didRestoreReturnStateRef: MutableRefObject<boolean>;
  loading: boolean;
  namespace?: string;
};

/**
 * Owns the two mount-time concerns of returning from an image detail page:
 * restoring the saved scroll position, and stripping the return-state query
 * params from the URL.
 */
export function useGalleryReturnNavigation({
  initialGalleryReturnStateRef,
  didRestoreReturnStateRef,
  loading,
  namespace,
}: UseGalleryReturnNavigationOptions) {
  // Restore scroll position when returning from a detail page.
  // Page is restored during initial state hydration to avoid a visible jump.
  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    if (didRestoreReturnStateRef.current) return;
    if (loading) return;
    const parsed = initialGalleryReturnStateRef.current;
    if (!parsed) return;
    const activeNamespace = namespace ?? '';
    if (parsed.namespace !== activeNamespace) return;

    didRestoreReturnStateRef.current = true;
    clearGalleryReturnState();
    window.sessionStorage.removeItem(GALLERY_RETURN_SNAPSHOT_KEY);

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.scrollTo({ top: parsed.scrollY, behavior: 'auto' });
      });
    });
  }, [didRestoreReturnStateRef, initialGalleryReturnStateRef, loading, namespace]);

  // If we arrived via `/?gpage=...&gns=...`, clean up the URL once mounted.
  // These params must not linger: the root page keys the gallery on `focus`
  // alone, and stale return params would confuse a later hydration.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const url = new URL(window.location.href);
      if (!url.searchParams.has('gpage') && !url.searchParams.has('gns') && !url.searchParams.has('gcolor')) return;
      url.searchParams.delete('gpage');
      url.searchParams.delete('gns');
      url.searchParams.delete('gcolor');
      window.history.replaceState(window.history.state, '', url.toString());
    } catch {
      // ignore
    }
  }, []);
}
