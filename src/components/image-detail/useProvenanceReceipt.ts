'use client';

import { useEffect, useState } from 'react';

export function useProvenanceReceipt(url: string, open: boolean) {
  const [json, setJson] = useState<string>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setJson(undefined);
    setError(undefined);
    setLoading(true);
    void fetch(`${url}&view=inline`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Receipt retrieval failed. Close and reopen to retry.');
        const text = await response.text();
        const pretty = JSON.stringify(JSON.parse(text), null, 2);
        if (!controller.signal.aborted) setJson(pretty);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Receipt retrieval failed');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [url, open]);

  return { json, error, loading };
}
