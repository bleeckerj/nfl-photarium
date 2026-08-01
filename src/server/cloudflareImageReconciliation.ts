import type { CachedCloudflareImage } from './cloudflareImageCacheMapper';
import type { CloudflareImageMutation } from './cloudflareImageMutationJournal';

export const mergeCachedImageRecord = (
  existing: CachedCloudflareImage | undefined,
  incoming: CachedCloudflareImage
): CachedCloudflareImage => {
  if (!existing) return incoming;
  return {
    ...existing,
    ...incoming,
    size: incoming.size ?? existing.size,
    contentType: incoming.contentType ?? existing.contentType,
    aspectRatio: incoming.aspectRatio ?? existing.aspectRatio,
    dimensions: incoming.dimensions ?? existing.dimensions,
    hasClipEmbedding: incoming.hasClipEmbedding ?? existing.hasClipEmbedding,
    hasColorEmbedding: incoming.hasColorEmbedding ?? existing.hasColorEmbedding,
    dominantColors: incoming.dominantColors ?? existing.dominantColors,
    averageColor: incoming.averageColor ?? existing.averageColor,
  };
};

export const mutationIsReflectedRemotely = (
  mutation: CloudflareImageMutation,
  remote: CachedCloudflareImage | undefined
) => {
  if (mutation.kind === 'delete') return remote === undefined;
  if (!remote) return false;
  const expected = mutation.image;
  return (
    remote.filename === expected.filename
    && remote.namespace === expected.namespace
    && remote.folder === expected.folder
    && remote.parentId === expected.parentId
    && JSON.stringify(remote.tags ?? []) === JSON.stringify(expected.tags ?? [])
  );
};

const valuesEqual = (left: unknown, right: unknown): boolean => {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => valuesEqual(value, right[index]));
  }
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
      if (!valuesEqual(
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key]
      )) {
        return false;
      }
    }
    return true;
  }
  return false;
};

// Deep comparison over every field (including future ones) so that a missed
// field can only cause a spurious version bump, never a suppressed real change.
export const cachedImageRecordsEqual = (
  existing: CachedCloudflareImage | undefined,
  merged: CachedCloudflareImage
): boolean => {
  if (!existing) return false;
  return valuesEqual(existing, merged);
};

const arraysEqual = (left?: string[], right?: string[]) => {
  if (left === right) return true;
  if ((left?.length ?? 0) !== (right?.length ?? 0)) return false;
  return (left ?? []).every((value, index) => value === right?.[index]);
};

export const catalogContentsEqual = (
  previous: Map<string, CachedCloudflareImage>,
  next: CachedCloudflareImage[]
) => {
  if (previous.size !== next.length) return false;
  return next.every((image) => {
    const existing = previous.get(image.id);
    if (!existing) return false;
    return (
      existing.filename === image.filename
      && existing.uploaded === image.uploaded
      && existing.namespace === image.namespace
      && existing.folder === image.folder
      && existing.parentId === image.parentId
      && existing.description === image.description
      && existing.displayName === image.displayName
      && existing.originalUrlNormalized === image.originalUrlNormalized
      && existing.sourceUrlNormalized === image.sourceUrlNormalized
      && existing.contentHash === image.contentHash
      && existing.size === image.size
      && existing.aspectRatio === image.aspectRatio
      && existing.hasClipEmbedding === image.hasClipEmbedding
      && existing.hasColorEmbedding === image.hasColorEmbedding
      && arraysEqual(existing.tags, image.tags)
      && arraysEqual(existing.variants, image.variants)
    );
  });
};
