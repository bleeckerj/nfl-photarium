export type UrlReviewCandidate = {
  id: string;
  kind: 'image' | 'video';
  url: string;
  filename: string;
  previewUrl?: string;
  posterUrl?: string;
};

export type UrlReviewProgress = {
  message: string;
  scrollCount: number;
  imageCount: number;
  pageNum?: number;
};

export type UrlReviewManifest = {
  query: string;
  source: string;
  imageUrls: string[];
};

export const buildUrlReviewManifest = (
  sourceUrl: string,
  candidates: UrlReviewCandidate[],
  keptUrls: ReadonlySet<string>
): UrlReviewManifest => ({
  query: sourceUrl,
  source: sourceUrl,
  imageUrls: candidates
    .filter((candidate) => candidate.kind === 'image' && keptUrls.has(candidate.url))
    .map((candidate) => candidate.url),
});
