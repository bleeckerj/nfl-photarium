const stripWrappingQuotes = (value: string) => value.replace(/^["']+|["']+$/g, '').trim();

const stripMarkdownFences = (value: string) =>
  value
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

const normalizeRawTagText = (value: string) => stripWrappingQuotes(stripMarkdownFences(value));

const splitCandidates = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string');
  }
  if (typeof value !== 'string') {
    return [];
  }
  const normalized = normalizeRawTagText(value);
  if (!normalized) {
    return [];
  }
  return normalized
    .split(/[,\n;|•]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const expandCollapsedSingleWordList = (candidates: string[]) => {
  if (candidates.length !== 1) return candidates;
  const [entry] = candidates;
  const collapsed = entry
    .split(/[\s-]+/g)
    .map((part) => part.trim())
    .filter(Boolean);
  return collapsed.length > 1 ? collapsed : candidates;
};

const expandCollapsedPhraseList = (candidates: string[], maxCount: number) => {
  if (candidates.length !== 1) return candidates;
  const [entry] = candidates;
  const collapsed = entry
    .split(/-+/g)
    .map((part) => part.trim())
    .filter(Boolean);
  return collapsed.length >= Math.max(4, maxCount) ? collapsed : candidates;
};

const normalizeSingleWordTag = (value: string) =>
  value
    .toLowerCase()
    .replace(/[`'".,;:!?()[\]{}]/g, ' ')
    .replace(/[_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s+/g, '-');

const normalizePhraseTag = (value: string) =>
  value
    .toLowerCase()
    .replace(/[_/]+/g, ' ')
    .replace(/[^\w\s-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const dedupeAndLimit = (values: string[], maxCount: number) => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= maxCount) break;
  }
  return out;
};

export const sanitizeSingleWordSuggestedTags = (value: unknown, maxCount: number): string[] => {
  const candidates = expandCollapsedSingleWordList(splitCandidates(value));
  return dedupeAndLimit(candidates.map(normalizeSingleWordTag).filter(Boolean), maxCount);
};

export const sanitizePhraseSuggestedTags = (value: unknown, maxCount: number): string[] => {
  const candidates = expandCollapsedPhraseList(splitCandidates(value), maxCount);
  return dedupeAndLimit(candidates.map(normalizePhraseTag).filter(Boolean), maxCount);
};
