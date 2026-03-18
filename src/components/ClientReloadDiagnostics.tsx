'use client';

import { useEffect } from 'react';

type ClientEventType = 'load' | 'beforeunload' | 'pagehide' | 'visibilitychange';

const endpoint = '/api/client-events';

function sendClientEvent(eventType: ClientEventType, details?: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  try {
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const payload = {
      eventType,
      href: window.location.href,
      referrer: document.referrer || '',
      visibilityState: document.visibilityState,
      timestamp: new Date().toISOString(),
      navigationType: navigation?.type || 'unknown',
      ...(details || {}),
    };
    const body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
      return;
    }
    void fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    });
  } catch {
    // No-op: diagnostics should never break app behavior.
  }
}

export function ClientReloadDiagnostics() {
  useEffect(() => {
    sendClientEvent('load');

    const originalPushState = window.history.pushState.bind(window.history);
    const originalReplaceState = window.history.replaceState.bind(window.history);
    const originalAssign = window.location.assign.bind(window.location);
    const originalReplace = window.location.replace.bind(window.location);

    window.history.pushState = ((data: unknown, unused: string, url?: string | URL | null) => {
      sendClientEvent('visibilitychange', {
        source: 'history.pushState',
        targetUrl: url ? String(url) : '',
        stack: new Error().stack,
      });
      return originalPushState(data, unused, url);
    }) as History['pushState'];

    window.history.replaceState = ((data: unknown, unused: string, url?: string | URL | null) => {
      sendClientEvent('visibilitychange', {
        source: 'history.replaceState',
        targetUrl: url ? String(url) : '',
        stack: new Error().stack,
      });
      return originalReplaceState(data, unused, url);
    }) as History['replaceState'];

    window.location.assign = ((url: string | URL) => {
      sendClientEvent('beforeunload', {
        source: 'location.assign',
        targetUrl: String(url),
        stack: new Error().stack,
      });
      return originalAssign(url);
    }) as Location['assign'];

    window.location.replace = ((url: string | URL) => {
      sendClientEvent('beforeunload', {
        source: 'location.replace',
        targetUrl: String(url),
        stack: new Error().stack,
      });
      return originalReplace(url);
    }) as Location['replace'];

    const handleBeforeUnload = () => sendClientEvent('beforeunload');
    const handlePageHide = () => sendClientEvent('pagehide');
    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      sendClientEvent('visibilitychange', {
        source: 'anchor.click',
        targetUrl: anchor.href,
        text: anchor.textContent?.trim().slice(0, 80) || '',
      });
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        sendClientEvent('visibilitychange');
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handlePageHide);
    document.addEventListener('click', handleDocumentClick, true);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
      window.location.assign = originalAssign;
      window.location.replace = originalReplace;
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('click', handleDocumentClick, true);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return null;
}
