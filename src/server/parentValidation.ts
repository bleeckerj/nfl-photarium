import { getCachedImages } from '@/server/cloudflareImageCache';

export type ParentValidationResult =
  | {
      ok: true;
      canonicalParentId?: string;
      redirectedFromParentId?: string;
    }
  | { ok: false; status: number; error: string };

const normalizeParentId = (value?: string | null) => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const resolveImages = async (options?: { forceRefresh?: boolean }) => {
  return getCachedImages(options?.forceRefresh === true);
};

const logParentRedirection = (requestedParentId: string, canonicalParentId: string) => {
  console.info('[parentValidation] Redirecting variant parent to canonical parent', {
    requestedParentId,
    canonicalParentId
  });
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
  let attemptedRefresh = options?.forceRefresh === true;
  const visited = new Set<string>();
  let currentId = parentId;

  while (currentId) {
    if (visited.has(currentId)) {
      return {
        ok: false,
        status: 400,
        error:
          'Unable to resolve the canonical parent due to a cyclical parent relationship. Please verify the image hierarchy manually.',
      };
    }
    visited.add(currentId);

    let current = images.find((img) => img.id === currentId);
    if (!current && !attemptedRefresh) {
      images = await resolveImages({ forceRefresh: true });
      attemptedRefresh = true;
      current = images.find((img) => img.id === currentId);
    }

    if (!current) {
      if (currentId === parentId) {
        return {
          ok: false,
          status: 400,
          error:
            'Parent image was not found. Please verify the image hierarchy manually and provide a canonical parent ID.',
        };
      }
      return {
        ok: false,
        status: 400,
        error:
          'Unable to resolve the canonical parent from the provided variant. Please verify the image hierarchy manually.',
      };
    }

    const nextParentId = normalizeParentId(current.parentId);
    if (!nextParentId) {
      if (currentId !== parentId) {
        logParentRedirection(parentId, currentId);
      }
      return {
        ok: true,
        canonicalParentId: currentId,
        redirectedFromParentId: currentId !== parentId ? parentId : undefined
      };
    }

    currentId = nextParentId;
  }

  return {
    ok: false,
    status: 400,
    error:
      'Unable to resolve the canonical parent from the provided variant. Please verify the image hierarchy manually.',
  };
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
