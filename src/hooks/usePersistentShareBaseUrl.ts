import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deriveInitialShareBaseUrl,
  isLocalhostOrigin,
  normalizeShareBaseUrl,
} from '@/services/shareLinkService';

export function usePersistentShareBaseUrl() {
  const [shareBaseUrl, setShareBaseUrl] = useState('');
  const initialResolvedRef = useRef('');
  const userEditedRef = useRef(false);

  const updateShareBaseUrl = useCallback((value: string) => {
    userEditedRef.current = true;
    setShareBaseUrl(value);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem('shareBaseUrl');
    const initial = deriveInitialShareBaseUrl({
      currentOrigin: window.location.origin,
      storedShareBaseUrl: stored,
    });
    initialResolvedRef.current = initial;
    setShareBaseUrl(initial);

    const currentIsLocal = isLocalhostOrigin(window.location.origin);
    if (!currentIsLocal) return;

    let cancelled = false;
    fetch('/api/system/network-origin', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = await response.json().catch(() => null);
        const candidate = normalizeShareBaseUrl(typeof payload?.origin === 'string' ? payload.origin : '');
        if (!candidate || cancelled) return;
        setShareBaseUrl((prev) => {
          if (userEditedRef.current) return prev;
          const normalizedPrev = normalizeShareBaseUrl(prev);
          if (
            !normalizedPrev ||
            normalizedPrev === initialResolvedRef.current ||
            isLocalhostOrigin(normalizedPrev)
          ) {
            return candidate;
          }
          return prev;
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!shareBaseUrl) return;
    window.localStorage.setItem('shareBaseUrl', shareBaseUrl);
  }, [shareBaseUrl]);

  return {
    shareBaseUrl,
    setShareBaseUrl: updateShareBaseUrl,
  };
}
