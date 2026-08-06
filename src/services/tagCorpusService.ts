import type { TagCorpusEntry } from '@/components/image-detail/tagEditor';

export const GLOBAL_TAG_CORPUS_URL = '/api/images?namespace=__all__&page=1&pageSize=1';

type TagCorpusResponse = {
  facets?: {
    tags?: unknown;
  } | null;
};

let cachedTagCorpus: TagCorpusEntry[] | null = null;
let pendingTagCorpus: Promise<TagCorpusEntry[]> | null = null;

export function parseTagCorpusResponse(value: unknown): TagCorpusEntry[] {
  const tags = (value as TagCorpusResponse | null)?.facets?.tags;
  if (!Array.isArray(tags)) return [];

  return tags.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const candidate = entry as { value?: unknown; count?: unknown };
    if (typeof candidate.value !== 'string' || typeof candidate.count !== 'number') return [];
    return [{ value: candidate.value, count: Number.isFinite(candidate.count) ? candidate.count : 0 }];
  });
}

export function fetchTagCorpus(signal?: AbortSignal): Promise<TagCorpusEntry[]> {
  if (cachedTagCorpus) return Promise.resolve(cachedTagCorpus);
  if (pendingTagCorpus) return pendingTagCorpus;

  pendingTagCorpus = fetch(GLOBAL_TAG_CORPUS_URL, { signal })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Tag corpus request failed (${response.status})`);
      const parsed = parseTagCorpusResponse(await response.json());
      cachedTagCorpus = parsed;
      return parsed;
    })
    .finally(() => {
      pendingTagCorpus = null;
    });

  return pendingTagCorpus;
}

export function clearTagCorpusCache(): void {
  cachedTagCorpus = null;
  pendingTagCorpus = null;
}
