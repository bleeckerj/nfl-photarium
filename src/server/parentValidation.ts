import { getCachedImages } from '@/server/cloudflareImageCache';

export type ParentValidationResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

const normalizeParentId = (value?: string | null) => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const resolveImages = async (options?: { forceRefresh?: boolean }) => {
  return getCachedImages(options?.forceRefresh === true);
};

export async function validateParentForNewChild(
  parentIdRaw?: string | null,
  options?: { forceRefresh?: boolean }
): Promise<ParentValidationResult> {
  const parentId = normalizeParentId(parentIdRaw);
  if (!parentId) {
    return { ok: true };
  }

  let images = await resolveImages(options);
  let parent = images.find((img) => img.id === parentId);

  // Avoid expensive force refresh on every request; only retry when parent lookup misses.
  if (!parent && !options?.forceRefresh) {
    images = await resolveImages({ forceRefresh: true });
    parent = images.find((img) => img.id === parentId);
  }

  if (!parent) {
    return { ok: false, status: 400, error: 'Parent image was not found.' };
  }

  if (parent.parentId) {
    return {
      ok: false,
      status: 400,
      error: 'Parent image must be canonical (a variation cannot be a parent).',
    };
  }

  return { ok: true };
}

export async function validateParentAssignmentForExistingImage(
  targetId: string,
  parentIdRaw?: string | null,
  options?: { forceRefresh?: boolean }
): Promise<ParentValidationResult> {
  const parentId = normalizeParentId(parentIdRaw);
  if (!parentId) {
    return { ok: true };
  }

  if (targetId === parentId) {
    return { ok: false, status: 400, error: 'An image cannot be its own parent.' };
  }

  let images = await resolveImages(options);
  let target = images.find((img) => img.id === targetId);
  let parent = images.find((img) => img.id === parentId);

  // Fast path from cache; refresh only if either side is missing.
  if ((!target || !parent) && !options?.forceRefresh) {
    images = await resolveImages({ forceRefresh: true });
    target = images.find((img) => img.id === targetId);
    parent = images.find((img) => img.id === parentId);
  }

  if (!target) {
    return { ok: false, status: 404, error: 'Target image was not found.' };
  }

  if (!parent) {
    return { ok: false, status: 400, error: 'Parent image was not found.' };
  }

  if (parent.parentId) {
    return {
      ok: false,
      status: 400,
      error: 'Parent image must be canonical (a variation cannot be a parent).',
    };
  }

  const targetHasChildren = images.some((img) => img.parentId === targetId);
  if (targetHasChildren) {
    return {
      ok: false,
      status: 400,
      error: 'Cannot assign a parent to an image that already has variations.',
    };
  }

  return { ok: true };
}
