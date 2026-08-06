import { isSystemTag } from '@/utils/systemTags';

export const CONTROL_TAGS = ['x-clip', 'x-color', 'x-search'] as const;
const CONTROL_TAG_SET = new Set<string>(CONTROL_TAGS);
const CONTROL_TAG_ORDER = new Map<string, number>(CONTROL_TAGS.map((tag, index) => [tag, index] as [string, number]));
const HYPHEN_RUN = /[-‐‑‒–—―﹘﹣－]+/gu;
const OPERATIONAL_TAG_PATTERN = /^(?:provider|model|workflow|source|namespace|filename|filepath|file|path|folder|upload|ingest)(?:[:=/_-]|$)/i;

export type TagCorpusEntry = {
  value: string;
  count: number;
};

export type TagDraftParts = {
  semanticTags: string[];
  controlTags: string[];
};

export type TagSubmission =
  | { ok: true; tag: string; source: 'exact' | 'corrected' | 'custom' }
  | { ok: false; reason: 'empty' | 'comma' | 'duplicate' | 'unsupported'; message: string };

export const normalizeSemanticTag = (value: string): string =>
  value.replace(HYPHEN_RUN, ' ').replace(/\s+/gu, ' ').trim();

export const isControlTag = (value: string): boolean =>
  CONTROL_TAG_SET.has(value.trim().toLocaleLowerCase());

export const isOperationalProvenanceTag = (value: string): boolean =>
  OPERATIONAL_TAG_PATTERN.test(value.trim());

export const compareTags = (left: string, right: string): number =>
  left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });

const normalizeKey = (value: string): string => normalizeSemanticTag(value).toLocaleLowerCase();

export function parseTagDraft(value: string): TagDraftParts {
  const semanticByKey = new Map<string, string>();
  const controlByKey = new Map<string, string>();

  value.split(',').forEach((rawValue) => {
    const rawTag = rawValue.trim();
    if (!rawTag || isSystemTag(rawTag)) return;

    if (isControlTag(rawTag)) {
      const controlTag = rawTag.toLocaleLowerCase();
      controlByKey.set(controlTag, controlTag);
      return;
    }

    const tag = normalizeSemanticTag(rawTag);
    const key = tag.toLocaleLowerCase();
    if (key && !semanticByKey.has(key)) semanticByKey.set(key, tag);
  });

  return {
    semanticTags: Array.from(semanticByKey.values()).sort(compareTags),
    controlTags: Array.from(controlByKey.values()).sort((left, right) => (
      (CONTROL_TAG_ORDER.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (CONTROL_TAG_ORDER.get(right) ?? Number.MAX_SAFE_INTEGER)
    )),
  };
}

export const serializeTagDraft = ({ semanticTags, controlTags }: TagDraftParts): string => [
  ...Array.from(new Set(semanticTags.map(normalizeSemanticTag).filter(Boolean))).sort(compareTags),
  ...Array.from(new Set(controlTags.map((tag) => tag.trim().toLocaleLowerCase()).filter(isControlTag))).sort(
    (left, right) => (CONTROL_TAG_ORDER.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (CONTROL_TAG_ORDER.get(right) ?? Number.MAX_SAFE_INTEGER)
  ),
].join(', ');

export function getCorpusSemanticTags(entries: readonly TagCorpusEntry[]): TagCorpusEntry[] {
  const byKey = new Map<string, TagCorpusEntry>();

  entries.forEach((entry) => {
    const rawValue = entry.value.trim();
    if (!rawValue || isSystemTag(rawValue) || isControlTag(rawValue) || isOperationalProvenanceTag(rawValue)) {
      return;
    }

    const value = normalizeSemanticTag(rawValue);
    const key = value.toLocaleLowerCase();
    if (!key) return;

    const candidate = { value, count: Math.max(0, entry.count) };
    const existing = byKey.get(key);
    if (!existing || candidate.count > existing.count || (candidate.count === existing.count && compareTags(candidate.value, existing.value) < 0)) {
      byKey.set(key, candidate);
    }
  });

  return Array.from(byKey.values()).sort((left, right) => {
    if (right.count !== left.count) return right.count - left.count;
    return compareTags(left.value, right.value);
  });
}

const getEditDistance = (left: string, right: string): number => {
  const rows = left.length + 1;
  const columns = right.length + 1;
  const distances = Array.from({ length: rows }, () => Array<number>(columns).fill(0));

  for (let row = 0; row < rows; row += 1) distances[row][0] = row;
  for (let column = 0; column < columns; column += 1) distances[0][column] = column;

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1;
      distances[row][column] = Math.min(
        distances[row - 1][column] + 1,
        distances[row][column - 1] + 1,
        distances[row - 1][column - 1] + substitutionCost,
      );
      if (
        row > 1 &&
        column > 1 &&
        left[row - 1] === right[column - 2] &&
        left[row - 2] === right[column - 1]
      ) {
        distances[row][column] = Math.min(distances[row][column], distances[row - 2][column - 2] + 1);
      }
    }
  }
  return distances[left.length][right.length];
};

const getCorrectionDistance = (value: string): number => {
  if (value.length < 3) return 0;
  if (value.length <= 8) return 1;
  return 2;
};

export function getTagSuggestions(
  input: string,
  entries: readonly TagCorpusEntry[],
  existingTags: readonly string[],
  limit = 8,
): TagCorpusEntry[] {
  const query = normalizeKey(input);
  if (!query) return [];

  const existing = new Set(existingTags.map(normalizeKey));
  return getCorpusSemanticTags(entries)
    .filter((entry) => {
      const key = normalizeKey(entry.value);
      return !existing.has(key) && key.includes(query);
    })
    .sort((left, right) => {
      const leftKey = normalizeKey(left.value);
      const rightKey = normalizeKey(right.value);
      const leftPrefix = leftKey.startsWith(query) ? 0 : 1;
      const rightPrefix = rightKey.startsWith(query) ? 0 : 1;
      if (leftPrefix !== rightPrefix) return leftPrefix - rightPrefix;
      if (right.count !== left.count) return right.count - left.count;
      return compareTags(left.value, right.value);
    })
    .slice(0, limit);
}

export function submitTag(
  input: string,
  existingTags: readonly string[],
  corpus: readonly TagCorpusEntry[],
): TagSubmission {
  const rawInput = input.trim();
  if (!rawInput) return { ok: false, reason: 'empty', message: 'Type a tag before pressing Enter.' };
  if (rawInput.includes(',')) return { ok: false, reason: 'comma', message: 'Add one tag at a time.' };
  if (isControlTag(rawInput) || isSystemTag(rawInput)) {
    return { ok: false, reason: 'unsupported', message: 'This tag is managed by the exclusion controls.' };
  }

  const normalizedInput = normalizeSemanticTag(rawInput);
  const inputKey = normalizedInput.toLocaleLowerCase();
  if (!inputKey) return { ok: false, reason: 'empty', message: 'Type a tag before pressing Enter.' };

  const existing = new Set(existingTags.map(normalizeKey));
  if (existing.has(inputKey)) return { ok: false, reason: 'duplicate', message: 'That tag is already present.' };

  const candidates = getCorpusSemanticTags(corpus).filter((entry) => !existing.has(normalizeKey(entry.value)));
  const exact = candidates.find((entry) => normalizeKey(entry.value) === inputKey);
  if (exact) return { ok: true, tag: exact.value, source: 'exact' };

  const maximumDistance = getCorrectionDistance(inputKey);
  if (maximumDistance > 0) {
    const ranked = candidates
      .map((entry) => ({ entry, distance: getEditDistance(inputKey, normalizeKey(entry.value)) }))
      .filter(({ distance }) => distance <= maximumDistance)
      .sort((left, right) => {
        if (left.distance !== right.distance) return left.distance - right.distance;
        if (right.entry.count !== left.entry.count) return right.entry.count - left.entry.count;
        return compareTags(left.entry.value, right.entry.value);
      });
    if (ranked.length > 0 && ranked[0].distance < (ranked[1]?.distance ?? Number.MAX_SAFE_INTEGER)) {
      return { ok: true, tag: ranked[0].entry.value, source: 'corrected' };
    }
  }

  return { ok: true, tag: normalizedInput, source: 'custom' };
}
