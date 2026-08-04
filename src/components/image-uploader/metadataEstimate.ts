import { normalizeOriginalUrl } from '@/utils/urlNormalization';
import type { UploaderQueueItem } from '@/features/page-import/types';

export type MetadataOverrides = {
  folder?: string;
  tags?: string;
  description?: string;
  originalUrl?: string;
  sourceUrl?: string;
};

export type MetadataEstimateContext = {
  namespace?: string | null;
  parentId?: string | null;
};

/**
 * Byte size of the metadata payload Cloudflare will store, so the queue can warn
 * before an upload trips the per-image metadata limit. Empty and undefined
 * fields are dropped because they are not sent.
 */
export const estimateMetadataBytes = (payload: Record<string, unknown>): number => {
  const filtered = Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined && value !== '')
  );
  return new TextEncoder().encode(JSON.stringify(filtered)).length;
};

export const buildMetadataEstimate = (
  item: UploaderQueueItem,
  overrides: MetadataOverrides,
  context: MetadataEstimateContext
): number => {
  const tagList = overrides.tags
    ? overrides.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
    : undefined;

  return estimateMetadataBytes({
    filename: item.filename,
    displayName: item.filename,
    uploadedAt: new Date().toISOString(),
    size: item.file?.size ?? item.sizeBytes ?? 0,
    type: item.file?.type ?? item.contentType ?? undefined,
    folder: overrides.folder || undefined,
    tags: tagList,
    description: overrides.description || undefined,
    originalUrl: overrides.originalUrl || undefined,
    originalUrlNormalized: normalizeOriginalUrl(overrides.originalUrl),
    sourceUrl: overrides.sourceUrl || undefined,
    sourceUrlNormalized: normalizeOriginalUrl(overrides.sourceUrl),
    namespace: context.namespace || undefined,
    variationParentId: context.parentId || undefined,
  });
};
