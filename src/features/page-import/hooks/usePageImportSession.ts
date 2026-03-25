'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ImportSessionState,
  UploaderQueueItem,
} from '@/features/page-import/types';

type MetadataPatch = {
  id: string;
  url: string;
  metadata: UploaderQueueItem['metadata'];
  tempAssetKey?: string;
};

const revokePreviewUrl = (item: UploaderQueueItem) => {
  if (item.previewUrl && item.previewUrl.startsWith('blob:')) {
    URL.revokeObjectURL(item.previewUrl);
  }
};

const deleteImportSession = async (sessionId: string) => {
  await fetch(`/api/import/page/metadata/session/${sessionId}`, {
    method: 'DELETE',
    keepalive: true,
  }).catch(() => undefined);
};

const deleteImportAsset = async (sessionId: string, assetKey?: string, url?: string) => {
  if (!assetKey && !url) return;
  await fetch(`/api/import/page/metadata/session/${sessionId}/asset`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetKey, url }),
    keepalive: true,
  }).catch(() => undefined);
};

export function usePageImportSession() {
  const [queuedFiles, setQueuedFiles] = useState<UploaderQueueItem[]>([]);
  const [importSession, setImportSession] = useState<ImportSessionState>({
    sessionId: null,
    status: 'idle',
  });
  const queuedFilesRef = useRef<UploaderQueueItem[]>([]);

  useEffect(() => {
    queuedFilesRef.current = queuedFiles;
  }, [queuedFiles]);

  const createQueueId = useCallback(
    () =>
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2),
    []
  );

  const ensureImportSession = useCallback(async () => {
    if (importSession.sessionId && importSession.status === 'ready') {
      return importSession.sessionId;
    }

    setImportSession((prev) => ({
      sessionId: prev.sessionId,
      status: 'creating',
    }));

    try {
      const response = await fetch('/api/import/page/metadata/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: importSession.sessionId || undefined,
        }),
      });
      const payload = await response.json();
      if (!response.ok || typeof payload?.sessionId !== 'string') {
        throw new Error(payload?.error || 'Failed to create import session');
      }
      setImportSession({
        sessionId: payload.sessionId,
        status: 'ready',
      });
      return payload.sessionId as string;
    } catch (error) {
      setImportSession({
        sessionId: null,
        status: 'error',
        error: error instanceof Error ? error.message : 'Failed to create import session',
      });
      throw error;
    }
  }, [importSession.sessionId, importSession.status]);

  const updateQueuedFile = useCallback((id: string, updates: Partial<UploaderQueueItem>) => {
    setQueuedFiles((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
    );
  }, []);

  const addQueuedFiles = useCallback((items: UploaderQueueItem[]) => {
    setQueuedFiles((prev) => {
      const existing = new Set(prev.map((item) => item.remoteUrl || item.originalUrl || item.filename));
      const seenIncoming = new Set<string>();
      const filtered = items.filter((item) => {
        const key = item.remoteUrl || item.originalUrl || item.filename;
        if (existing.has(key) || seenIncoming.has(key)) {
          return false;
        }
        seenIncoming.add(key);
        return true;
      });
      return [...prev, ...filtered];
    });
  }, []);

  const applyMetadataPatches = useCallback((patches: MetadataPatch[]) => {
    if (!patches.length) return;
    const patchesById = new Map(patches.map((patch) => [patch.id, patch]));
    const patchesByUrl = new Map(patches.map((patch) => [patch.url, patch]));

    setQueuedFiles((prev) =>
      prev.map((item) => {
        const patch =
          patchesById.get(item.id) ||
          (item.remoteUrl ? patchesByUrl.get(item.remoteUrl) : undefined);
        if (!patch) return item;
        return {
          ...item,
          metadata: patch.metadata,
          sizeBytes: patch.metadata?.fileSizeBytes ?? item.sizeBytes,
          contentType: patch.metadata?.contentType ?? item.contentType,
          tempAssetKey: patch.tempAssetKey ?? item.tempAssetKey,
        };
      })
    );
  }, []);

  const removeQueuedFile = useCallback((id: string) => {
    const target = queuedFilesRef.current.find((item) => item.id === id);
    if (!target) return;
    revokePreviewUrl(target);
    setQueuedFiles((prev) => prev.filter((item) => item.id !== id));
    if (target.importSessionId) {
      void deleteImportAsset(target.importSessionId, target.tempAssetKey, target.remoteUrl);
    }
  }, []);

  const clearQueue = useCallback(() => {
    const items = [...queuedFilesRef.current];
    items.forEach(revokePreviewUrl);
    setQueuedFiles([]);

    const sessionIds = new Set(
      items.map((item) => item.importSessionId).filter((value): value is string => Boolean(value))
    );
    sessionIds.forEach((sessionId) => {
      void deleteImportSession(sessionId);
    });
  }, []);

  useEffect(() => {
    return () => {
      const items = [...queuedFilesRef.current];
      items.forEach(revokePreviewUrl);
      const sessionIds = new Set(
        items.map((item) => item.importSessionId).filter((value): value is string => Boolean(value))
      );
      sessionIds.forEach((sessionId) => {
        void deleteImportSession(sessionId);
      });
    };
  }, []);

  return {
    queuedFiles,
    setQueuedFiles,
    updateQueuedFile,
    addQueuedFiles,
    applyMetadataPatches,
    removeQueuedFile,
    clearQueue,
    createQueueId,
    importSession,
    ensureImportSession,
  };
}
