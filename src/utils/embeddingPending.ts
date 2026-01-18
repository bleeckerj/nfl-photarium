export type EmbeddingPendingStatus = 'queued' | 'embedding' | 'error';

export type EmbeddingPendingEntry = {
  status: EmbeddingPendingStatus;
  clip: boolean;
  color: boolean;
  error?: string;
  updatedAt: string;
};

const STORAGE_KEY = 'embeddingPendingMap';
// Pending entries older than this are considered stale and removed
const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

const isBrowser = () => typeof window !== 'undefined';

/**
 * Check if an entry is stale (older than threshold)
 */
const isStaleEntry = (entry: EmbeddingPendingEntry): boolean => {
  if (!entry.updatedAt) return true;
  const age = Date.now() - new Date(entry.updatedAt).getTime();
  return age > STALE_THRESHOLD_MS;
};

/**
 * Clean up stale entries from the map
 */
const cleanStaleEntries = (map: Record<string, EmbeddingPendingEntry>): Record<string, EmbeddingPendingEntry> => {
  const cleaned: Record<string, EmbeddingPendingEntry> = {};
  let hasStale = false;
  
  for (const [id, entry] of Object.entries(map)) {
    if (!isStaleEntry(entry)) {
      cleaned[id] = entry;
    } else {
      hasStale = true;
    }
  }
  
  // If we cleaned anything, save the cleaned map
  if (hasStale && isBrowser()) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
    } catch {
      // ignore
    }
  }
  
  return cleaned;
};

export const getEmbeddingPendingMap = (): Record<string, EmbeddingPendingEntry> => {
  if (!isBrowser()) {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    // Clean stale entries on every read
    return cleanStaleEntries(parsed as Record<string, EmbeddingPendingEntry>);
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

/**
 * Clear pending status for an image if it already has embeddings.
 * Call this when you know the image has embeddings to sync UI state.
 */
export const clearPendingIfHasEmbeddings = (
  id: string, 
  hasClipEmbedding?: boolean, 
  hasColorEmbedding?: boolean
) => {
  if (!isBrowser()) return;
  
  const map = getEmbeddingPendingMap();
  const pending = map[id];
  
  if (!pending) return;
  
  // Check if the pending embeddings are now complete
  const clipComplete = !pending.clip || hasClipEmbedding;
  const colorComplete = !pending.color || hasColorEmbedding;
  
  if (clipComplete && colorComplete) {
    // All requested embeddings are done, clear the pending state
    setEmbeddingPendingEntry(id, undefined);
  }
};

/**
 * Clear all pending entries (useful for debugging)
 */
export const clearAllPending = () => {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new Event('embedding-pending-updated'));
  } catch {
    // ignore
  }
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
