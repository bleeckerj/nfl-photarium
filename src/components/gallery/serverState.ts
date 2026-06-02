import type { CloudflareImage, GalleryFamilySummary } from './types';

export type VideoMetaState = {
  enabled: boolean;
  limit: number;
  returned: number;
  totalScoped: number;
  truncated: boolean;
} | null;

export type GalleryServerPagination = {
  page: number;
  pageSize: number;
  scopeTotal?: number;
  total: number;
  totalPages: number;
};

export type GalleryServerFocus = {
  assetId: string;
  found: boolean;
  index: number;
  ordinal: number;
  page: number;
  pageSize: number;
  total: number;
} | null;

export type GalleryServerFacets = {
  folders: Array<{ value: string; count: number }>;
  tags: Array<{ value: string; count: number }>;
};

export type GalleryDuplicateSummary = {
  groupCount: number;
  imageCount: number;
  pageDuplicateIds: string[];
  allDuplicateIds?: string[];
  duplicateIdsExcludingNewest?: string[];
  duplicateIdsExcludingOldest?: string[];
};

export function dedupeGalleryImages(rawImages: CloudflareImage[] = []) {
  const seen = new Set<string>();
  return rawImages.filter((img) => {
    if (seen.has(img.id)) return false;
    seen.add(img.id);
    return true;
  });
}

export function parseGalleryServerPagination(value: unknown): GalleryServerPagination | null {
  const pagination = value as Partial<GalleryServerPagination> | null | undefined;
  if (
    pagination &&
    typeof pagination.page === 'number' &&
    typeof pagination.pageSize === 'number' &&
    typeof pagination.total === 'number' &&
    typeof pagination.totalPages === 'number'
  ) {
    return {
      page: pagination.page,
      pageSize: pagination.pageSize,
      scopeTotal: typeof pagination.scopeTotal === 'number' ? pagination.scopeTotal : undefined,
      total: pagination.total,
      totalPages: pagination.totalPages,
    };
  }
  return null;
}

export function parseGalleryServerFocus(value: unknown): GalleryServerFocus {
  const focus = value as Partial<NonNullable<GalleryServerFocus>> | null | undefined;
  if (
    focus &&
    typeof focus.assetId === 'string' &&
    typeof focus.found === 'boolean' &&
    typeof focus.index === 'number' &&
    typeof focus.ordinal === 'number' &&
    typeof focus.page === 'number' &&
    typeof focus.pageSize === 'number' &&
    typeof focus.total === 'number'
  ) {
    return {
      assetId: focus.assetId,
      found: focus.found,
      index: focus.index,
      ordinal: focus.ordinal,
      page: focus.page,
      pageSize: focus.pageSize,
      total: focus.total,
    };
  }
  return null;
}

export function parseGalleryVideoMeta(value: unknown): VideoMetaState {
  const meta = value as
    | { truncated?: boolean; returned?: number; totalScoped?: number; limit?: number; enabled?: boolean }
    | undefined;
  return meta
    ? {
        enabled: Boolean(meta.enabled),
        limit: typeof meta.limit === 'number' ? meta.limit : 0,
        returned: typeof meta.returned === 'number' ? meta.returned : 0,
        totalScoped: typeof meta.totalScoped === 'number' ? meta.totalScoped : 0,
        truncated: Boolean(meta.truncated),
      }
    : null;
}

export function formatVideoResultsNotice(videoMeta: VideoMetaState) {
  if (!videoMeta?.enabled || !videoMeta.truncated) return null;
  const returned = videoMeta.returned;
  const totalScoped = videoMeta.totalScoped || returned;
  const limit = videoMeta.limit || returned;
  return `Showing ${returned} of ${totalScoped} videos (limit ${limit}). Page near the end to auto-load more, or use “Load more videos”.`;
}

export function parseGalleryServerFamilySummaryMap(value: unknown): Record<string, GalleryFamilySummary> {
  return value && typeof value === 'object' ? value as Record<string, GalleryFamilySummary> : {};
}
