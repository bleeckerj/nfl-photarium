'use client';

import { useEffect, useState } from 'react';
import type { ProvenanceBinding } from '@/types/generationProvenance';

export function useProvenanceReceipts(imageId: string, available?: boolean) {
  const [receipts, setReceipts] = useState<ProvenanceBinding[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setReceipts([]);
    setError(undefined);
    if (!available) { setLoading(false); return () => controller.abort(); }
    setLoading(true);
    void fetch(`/api/images/${encodeURIComponent(imageId)}/provenance`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Receipt retrieval failed');
        const payload: { receipts?: ProvenanceBinding[] } = await response.json();
        if (!controller.signal.aborted) setReceipts(payload.receipts ?? []);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Receipt retrieval failed');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [imageId, available]);
  return { receipts, loading, error };
}
