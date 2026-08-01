/**
 * Pure helpers for reference-image ("looks like") search.
 *
 * Kept free of React/DOM rendering so the logic is unit-testable per repo
 * convention; ReferenceImageDropzone and TextSearch consume these.
 */

export const ACCEPTED_REFERENCE_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/svg+xml',
] as const;

export const MAX_REFERENCE_FILE_BYTES = 25 * 1024 * 1024;

export interface ReferenceSearchResult {
  imageId: string;
  score?: number;
  filename?: string;
  folder?: string;
  matchType?: string;
  assetType?: 'image' | 'video';
  videoThumbnailUrl?: string;
  videoPlaybackUrl?: string;
}

export interface ReferenceSearchResponse {
  type: 'upload';
  exactMatches: ReferenceSearchResult[];
  results: ReferenceSearchResult[];
  count: number;
  coverage: { totalImages: number; withClip: number; notIndexed: number };
  warnings: string[];
}

export function validateReferenceFile(file: {
  type: string;
  size: number;
}): { ok: true } | { ok: false; reason: string } {
  if (!(ACCEPTED_REFERENCE_MIME as readonly string[]).includes(file.type)) {
    return {
      ok: false,
      reason: 'Unsupported image type. Use JPEG, PNG, WebP, GIF, AVIF, or SVG.',
    };
  }
  if (file.size > MAX_REFERENCE_FILE_BYTES) {
    return {
      ok: false,
      reason: `Image is too large (max ${(MAX_REFERENCE_FILE_BYTES / 1024 / 1024).toFixed(0)}MB).`,
    };
  }
  return { ok: true };
}

export function buildReferenceSearchFormData(
  file: File,
  limit: number,
  namespace: string | null
): FormData {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('limit', String(limit));
  if (namespace !== null) {
    formData.append('namespace', namespace);
  }
  return formData;
}

export function extractImageFileFromClipboard(
  items: DataTransferItemList | null | undefined
): File | null {
  if (!items) return null;
  for (const item of Array.from(items)) {
    if (item.kind !== 'file') continue;
    if (!item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (file) return file;
  }
  return null;
}

export function formatWarningMessage(warning: string): string | null {
  switch (warning) {
    case 'clip-unavailable':
      return 'Similarity search is unavailable (embedding provider not reachable) — showing exact matches only.';
    case 'vector-search-unavailable':
      return 'Vector search is unavailable — showing exact matches only.';
    default:
      return null;
  }
}
