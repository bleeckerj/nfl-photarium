export type UrlManifestInput = {
  imageUrls?: unknown;
  urls?: unknown;
  source?: unknown;
  query?: unknown;
};

export type ParsedUrlManifest = {
  urls: string[];
  sourceUrl?: string;
  query?: string;
  invalidCount: number;
  duplicateCount: number;
};

const isHttpUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const readUrlEntries = (input: unknown): { entries: unknown[]; source?: unknown; query?: unknown } => {
  if (Array.isArray(input)) {
    return { entries: input };
  }
  if (!input || typeof input !== 'object') {
    throw new Error('JSON must be an array of URLs or an object containing an imageUrls array.');
  }

  const manifest = input as UrlManifestInput;
  const entries = Array.isArray(manifest.imageUrls)
    ? manifest.imageUrls
    : Array.isArray(manifest.urls)
      ? manifest.urls
      : null;
  if (!entries) {
    throw new Error('JSON must contain an imageUrls or urls array.');
  }
  return { entries, source: manifest.source, query: manifest.query };
};

export const parseUrlManifest = (input: unknown): ParsedUrlManifest => {
  const { entries, source, query } = readUrlEntries(input);
  const urls: string[] = [];
  const seen = new Set<string>();
  let invalidCount = 0;
  let duplicateCount = 0;

  entries.forEach((entry) => {
    if (typeof entry !== 'string') {
      invalidCount += 1;
      return;
    }
    const url = entry.trim();
    if (!isHttpUrl(url)) {
      invalidCount += 1;
      return;
    }
    if (seen.has(url)) {
      duplicateCount += 1;
      return;
    }
    seen.add(url);
    urls.push(url);
  });

  if (urls.length === 0) {
    throw new Error('The JSON file does not contain any valid http(s) image URLs.');
  }

  const sourceUrl = typeof source === 'string' && isHttpUrl(source.trim()) ? source.trim() : undefined;
  const cleanQuery = typeof query === 'string' && query.trim() ? query.trim() : undefined;
  return { urls, sourceUrl, query: cleanQuery, invalidCount, duplicateCount };
};

export const parseUrlLines = (value: string): ParsedUrlManifest => {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    throw new Error('Enter at least one http(s) URL, one per line.');
  }
  try {
    return parseUrlManifest(lines);
  } catch {
    throw new Error('No valid http(s) URLs were found. Enter one URL per line.');
  }
};
