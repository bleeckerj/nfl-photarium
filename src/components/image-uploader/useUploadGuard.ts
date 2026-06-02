import { useEffect } from 'react';

export function useUploadGuard(active: boolean) {
  useEffect(() => {
    if (typeof window === 'undefined' || !active) {
      return;
    }

    const originalPushState = window.history.pushState.bind(window.history);
    const originalReplaceState = window.history.replaceState.bind(window.history);
    const currentPath = window.location.pathname + window.location.search + window.location.hash;

    const blockSpaNav = (kind: 'pushState' | 'replaceState', target?: string | URL | null) => {
      const targetUrl = target ? String(target) : '';
      if (targetUrl && targetUrl === currentPath) {
        return false;
      }
      console.warn('[UploadGuard] Blocked SPA navigation during active upload work', {
        kind,
        target: targetUrl || '(unknown)',
      });
      return true;
    };

    window.history.pushState = ((data: unknown, unused: string, url?: string | URL | null) => {
      if (blockSpaNav('pushState', url)) return;
      return originalPushState(data, unused, url);
    }) as History['pushState'];

    window.history.replaceState = ((data: unknown, unused: string, url?: string | URL | null) => {
      if (blockSpaNav('replaceState', url)) return;
      return originalReplaceState(data, unused, url);
    }) as History['replaceState'];

    const handlePopState = () => {
      console.warn('[UploadGuard] Blocked popstate navigation during active upload work');
      originalPushState(null, '', currentPath);
    };

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
      return '';
    };

    window.addEventListener('popstate', handlePopState, true);
    window.addEventListener('beforeunload', handleBeforeUnload, true);

    return () => {
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
      window.removeEventListener('popstate', handlePopState, true);
      window.removeEventListener('beforeunload', handleBeforeUnload, true);
    };
  }, [active]);
}
