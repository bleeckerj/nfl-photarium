'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ImportCandidateMetadata, UploaderQueueItem } from '@/features/page-import/types';

type MetadataPatch = {
  id: string;
  url: string;
  metadata: ImportCandidateMetadata;
  tempAssetKey?: string;
};

type EnrichmentTarget = {
  id: string;
  url: string;
  filename: string;
  metadata?: ImportCandidateMetadata;
  sessionId: string;
  selected: boolean;
  visible: boolean;
};

const needsEnrichment = (item: UploaderQueueItem) => {
  if (item.assetType !== 'image') return false;
  if (!item.remoteUrl || !item.importSessionId) return false;
  return item.metadata?.status !== 'resolved';
};

export const prioritizeMetadataEnrichmentCandidates = (
  queuedFiles: UploaderQueueItem[],
  visibleIds: string[]
) => {
  const visibleSet = new Set(visibleIds);
  const targets: EnrichmentTarget[] = queuedFiles
    .filter(needsEnrichment)
    .map((item) => ({
      id: item.id,
      url: item.remoteUrl as string,
      filename: item.filename,
      metadata: item.metadata,
      sessionId: item.importSessionId as string,
      selected: item.selected !== false,
      visible: visibleSet.has(item.id),
    }));

  return targets.sort((a, b) => {
    const score = (item: EnrichmentTarget) =>
      (item.visible ? 4 : 0) + (item.selected ? 2 : 0);
    return score(b) - score(a);
  });
};

export function useCandidateMetadataEnrichment(params: {
  queuedFiles: UploaderQueueItem[];
  visibleIds: string[];
  allowInsecure: boolean;
  cookieHeader: string;
  applyMetadataPatches: (patches: MetadataPatch[]) => void;
}) {
  const { queuedFiles, visibleIds, allowInsecure, cookieHeader, applyMetadataPatches } = params;
  const [cycle, setCycle] = useState(0);
  const inflight = useRef(new Set<string>());
  const running = useRef(false);
  const failed = useRef(new Set<string>());

  const prioritized = useMemo(
    () => prioritizeMetadataEnrichmentCandidates(queuedFiles, visibleIds),
    [queuedFiles, visibleIds]
  );

  useEffect(() => {
    if (running.current) return;
    const batch = prioritized
      .filter((item) => !inflight.current.has(item.id) && !failed.current.has(item.id))
      .slice(0, 6);
    if (batch.length === 0) return;

    running.current = true;
    batch.forEach((item) => inflight.current.add(item.id));

    const bySession = new Map<string, EnrichmentTarget[]>();
    batch.forEach((item) => {
      const sessionItems = bySession.get(item.sessionId) || [];
      sessionItems.push(item);
      bySession.set(item.sessionId, sessionItems);
    });

    const run = async () => {
      try {
        for (const [sessionId, candidates] of bySession.entries()) {
          const response = await fetch('/api/import/page/metadata/enrich', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId,
              allowInsecure,
              cookieHeader: cookieHeader.trim() || undefined,
              candidates: candidates.map((candidate) => ({
                id: candidate.id,
                url: candidate.url,
                filename: candidate.filename,
                metadata: candidate.metadata,
              })),
            }),
          });
          const payload = await response.json().catch(() => null);
          if (response.ok && Array.isArray(payload?.patches)) {
            applyMetadataPatches(payload.patches as MetadataPatch[]);
          } else {
            candidates.forEach((candidate) => failed.current.add(candidate.id));
          }
        }
      } catch {
        batch.forEach((item) => failed.current.add(item.id));
      } finally {
        batch.forEach((item) => inflight.current.delete(item.id));
        running.current = false;
        setCycle((value) => value + 1);
      }
    };

    void run();
  }, [allowInsecure, applyMetadataPatches, cookieHeader, cycle, prioritized]);
}
