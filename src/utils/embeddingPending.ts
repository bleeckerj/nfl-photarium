export type EmbeddingPendingStatus = 'queued' | 'embedding' | 'error';

export type EmbeddingPendingEntry = {
  status: EmbeddingPendingStatus;
  clip: boolean;
  color: boolean;
  error?: string;
  updatedAt: string;
};

const STORAGE_KEY = 'embeddingPendingMap';

const isBrowser = () => typeof window !== 'undefined';

export const getEmbeddingPendingMap = (): Record<string, EmbeddingPendingEntry> => {
  if (!isBrowser()) {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, EmbeddingPendingEntry>;
  } catch {
    return {};
  }
};

export const setEmbeddingPendingEntry = (id: string, entry?: EmbeddingPendingEntry) => {
  if (!isBrowser()) {
    return;
  }
  const map = getEmbeddingPendingMap();
  if (entry) {
    map[id] = entry;
  } else {
    delete map[id];
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event('embedding-pending-updated'));
};

export const subscribeEmbeddingPending = (
  callback: (map: Record<string, EmbeddingPendingEntry>) => void
) => {
  if (!isBrowser()) {
    return () => {};
  }
  const handler = () => callback(getEmbeddingPendingMap());
  handler();
  window.addEventListener('embedding-pending-updated', handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener('embedding-pending-updated', handler);
    window.removeEventListener('storage', handler);
  };
};
