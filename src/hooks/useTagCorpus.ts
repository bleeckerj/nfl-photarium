'use client';

import { useEffect, useState } from 'react';
import { fetchTagCorpus } from '@/services/tagCorpusService';
import type { TagCorpusEntry } from '@/components/image-detail/tagEditor';

export function useTagCorpus() {
  const [entries, setEntries] = useState<TagCorpusEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();

    fetchTagCorpus(controller.signal)
      .then((nextEntries) => {
        if (!mounted) return;
        setEntries(nextEntries);
        setLoading(false);
      })
      .catch((nextError: unknown) => {
        if (!mounted || controller.signal.aborted) return;
        setError(nextError instanceof Error ? nextError.message : 'Unable to load tag suggestions.');
        setLoading(false);
      });

    return () => {
      mounted = false;
      controller.abort();
    };
  }, []);

  return { entries, loading, error };
}
