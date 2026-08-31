export interface UrlReviewManifest {
  query: string;
  source: string;
  imageUrls: string[];
}

export const parseUrlReviewManifest = (value: unknown): UrlReviewManifest => {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  const sourceUrls = Array.isArray(value)
    ? value
    : record?.imageUrls ?? record?.urls;

  if (!Array.isArray(sourceUrls)) {
    throw new Error('The file must contain an imageUrls array or a JSON array of URLs.');
  }

  const imageUrls = [...new Set(
    sourceUrls.flatMap((candidate) => {
      if (typeof candidate !== 'string') return [];
      const url = candidate.trim();
      if (!url) return [];

      try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? [url] : [];
      } catch {
        return [];
      }
    })
  )];

  if (imageUrls.length === 0) {
    throw new Error('No valid http(s) image URLs were found.');
  }

  return {
    query: typeof record?.query === 'string' && record.query.trim() ? record.query.trim() : 'Image URL review',
    source: typeof record?.source === 'string' && record.source.trim() ? record.source.trim() : 'Loaded URL manifest',
    imageUrls,
  };
};

export const getUrlReviewStorageKey = (manifest: UrlReviewManifest): string =>
  `photarium-url-review:${manifest.query}:${manifest.imageUrls.length}:${manifest.imageUrls[0]}`;

export const buildSelectionManifest = (
  manifest: UrlReviewManifest,
  selectedUrls: ReadonlySet<string>
): UrlReviewManifest => ({
  query: manifest.query,
  source: manifest.source,
  imageUrls: manifest.imageUrls.filter((url) => selectedUrls.has(url)),
});
