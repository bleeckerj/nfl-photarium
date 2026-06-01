import { useEffect, type MutableRefObject } from 'react';

type DetailRouter = {
  replace: (href: string, options?: { scroll?: boolean }) => void;
};

export const useDetailNavigationGuard = ({
  id,
  buildAssetHref,
  router,
  lastUserNavIntentRef,
  pinnedImageIdRef,
}: {
  id?: string;
  buildAssetHref: (targetId: string) => string;
  router: DetailRouter;
  lastUserNavIntentRef: MutableRefObject<number>;
  pinnedImageIdRef: MutableRefObject<string | null>;
}) => {
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const NAV_INTENT_WINDOW_MS = 3000;
    const markUserNavIntent = () => {
      lastUserNavIntentRef.current = Date.now();
    };

    const handleIntentKeyDown = (event: KeyboardEvent) => {
      if (!event.isTrusted) return;
      if (event.key === 'Enter' || event.key === ' ') {
        markUserNavIntent();
      }
    };
    const handleIntentPointerDown = (event: PointerEvent) => {
      if (!event.isTrusted) return;
      markUserNavIntent();
    };

    const isDetailPath = (pathname: string) => /^\/(images|videos)\//.test(pathname);
    const toPathname = (target: string | URL | null | undefined) => {
      if (!target) return '';
      try {
        return new URL(String(target), window.location.href).pathname;
      } catch {
        return '';
      }
    };
    const hasRecentIntent = () => Date.now() - lastUserNavIntentRef.current < NAV_INTENT_WINDOW_MS;

    const originalPushState = window.history.pushState.bind(window.history);
    const originalReplaceState = window.history.replaceState.bind(window.history);

    window.history.pushState = ((data: unknown, unused: string, url?: string | URL | null) => {
      const targetPath = toPathname(url);
      if (
        targetPath &&
        targetPath !== window.location.pathname &&
        isDetailPath(targetPath) &&
        !hasRecentIntent()
      ) {
        console.warn('[NavGuard] Blocked non-user pushState navigation', {
          from: window.location.pathname,
          to: targetPath,
        });
        return;
      }
      return originalPushState(data, unused, url);
    }) as History['pushState'];

    window.history.replaceState = ((data: unknown, unused: string, url?: string | URL | null) => {
      const targetPath = toPathname(url);
      if (
        targetPath &&
        targetPath !== window.location.pathname &&
        isDetailPath(targetPath) &&
        !hasRecentIntent()
      ) {
        console.warn('[NavGuard] Blocked non-user replaceState navigation', {
          from: window.location.pathname,
          to: targetPath,
        });
        return;
      }
      return originalReplaceState(data, unused, url);
    }) as History['replaceState'];

    const handlePopState = () => {
      if (hasRecentIntent()) {
        return;
      }
      const pinnedId = pinnedImageIdRef.current;
      if (!pinnedId) {
        return;
      }
      const targetPath = `/images/${pinnedId}`;
      if (window.location.pathname !== targetPath) {
        console.warn('[NavGuard] Reverting unexpected popstate navigation', {
          from: window.location.pathname,
          to: targetPath,
        });
        router.replace(buildAssetHref(pinnedId), { scroll: false });
      }
    };

    const handleBeforeUnloadGuard = (event: BeforeUnloadEvent) => {
      if (hasRecentIntent()) {
        return;
      }
      event.preventDefault();
      event.returnValue = '';
      console.warn('[NavGuard] Blocked non-user unload/navigation');
    };

    window.addEventListener('pointerdown', handleIntentPointerDown, true);
    window.addEventListener('keydown', handleIntentKeyDown, true);
    window.addEventListener('popstate', handlePopState, true);
    window.addEventListener('beforeunload', handleBeforeUnloadGuard, true);

    return () => {
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
      window.removeEventListener('pointerdown', handleIntentPointerDown, true);
      window.removeEventListener('keydown', handleIntentKeyDown, true);
      window.removeEventListener('popstate', handlePopState, true);
      window.removeEventListener('beforeunload', handleBeforeUnloadGuard, true);
    };
  }, [buildAssetHref, lastUserNavIntentRef, pinnedImageIdRef, router]);

  useEffect(() => {
    if (!id) {
      return;
    }
    const pinnedId = pinnedImageIdRef.current;
    const hasRecentIntent = Date.now() - lastUserNavIntentRef.current < 3000;

    if (!pinnedId) {
      pinnedImageIdRef.current = id;
      return;
    }

    if (id !== pinnedId && !hasRecentIntent) {
      console.warn('[NavGuard] Reverting unexpected route change', {
        fromPinnedId: pinnedId,
        unexpectedId: id,
      });
      router.replace(buildAssetHref(pinnedId), { scroll: false });
      return;
    }

    pinnedImageIdRef.current = id;
  }, [buildAssetHref, id, lastUserNavIntentRef, pinnedImageIdRef, router]);
};
