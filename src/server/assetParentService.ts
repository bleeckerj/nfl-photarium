import {
  getCachedImages,
  upsertCachedImage,
} from '@/server/cloudflareImageCache';
import { getCloudflareCredentials } from '@/server/cloudflareClient';
import { listCatalogAssets, type CatalogAsset } from '@/server/assetCatalog';
import {
  getVideoAssetRecord,
  updateVideoAssetRecord,
} from '@/server/videoCatalogStorage';
import { pickCloudflareMetadata } from '@/utils/cloudflareMetadata';

const normalizeId = (value?: string | null) => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const CLOUDFLARE_PATCH_TIMEOUT_MS = Math.max(
  2_000,
  Number(process.env.ASSET_PARENT_PATCH_TIMEOUT_MS ?? 15_000)
);

export class ParentAssignmentError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const patchCloudflareImageParent = async (imageId: string, parentId: string) => {
  const { accountId, apiToken } = getCloudflareCredentials();
  const metadataPayload = pickCloudflareMetadata(
    {
      variationParentId: parentId,
      updatedAt: new Date().toISOString(),
    },
    { includeEmpty: true }
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CLOUDFLARE_PATCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1/${imageId}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ metadata: metadataPayload }),
        signal: controller.signal,
      }
    );
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ParentAssignmentError(
        504,
        `Cloudflare parent update timed out after ${CLOUDFLARE_PATCH_TIMEOUT_MS}ms`
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ParentAssignmentError(
      response.status,
      result?.errors?.[0]?.message || result?.error || 'Failed to update image parent metadata'
    );
  }
};

const resolveCanonicalAssetParent = (
  assets: CatalogAsset[],
  requestedParentId: string
): { canonicalParentId: string; redirectedFromParentId?: string } => {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const visited = new Set<string>();
  let currentId = requestedParentId;

  while (currentId) {
    if (visited.has(currentId)) {
      throw new ParentAssignmentError(
        400,
        'Unable to resolve the canonical parent due to a cyclical parent relationship. Please verify the asset hierarchy manually.'
      );
    }
    visited.add(currentId);

    const current = byId.get(currentId);
    if (!current) {
      if (currentId === requestedParentId) {
        throw new ParentAssignmentError(
          400,
          'Parent asset was not found. Please verify the asset hierarchy manually and provide a canonical parent ID.'
        );
      }
      throw new ParentAssignmentError(
        400,
        'Unable to resolve the canonical parent from the provided variant. Please verify the asset hierarchy manually.'
      );
    }

    const nextParentId = normalizeId(current.parentId);
    if (!nextParentId) {
      return {
        canonicalParentId: current.id,
        redirectedFromParentId: current.id !== requestedParentId ? requestedParentId : undefined,
      };
    }

    currentId = nextParentId;
  }

  throw new ParentAssignmentError(
    400,
    'Unable to resolve the canonical parent from the provided variant. Please verify the asset hierarchy manually.'
  );
};

export type AssignAssetParentResult = {
  targetId: string;
  targetAssetType: 'image' | 'video';
  parentId?: string;
  canonicalParentId?: string;
  redirectedFromParentId?: string;
  reparentedChildIds?: string[];
};

export type DetachAssetChildrenOutcome = {
  ok: boolean;
  id: string;
  status?: number;
  message?: string;
};

export type DetachAssetChildrenResult = {
  parentId: string;
  childIds: string[];
  detachedIds: string[];
  failed: Array<{ id: string; status: number; message: string }>;
};

type DirectParentAssignmentPlan = {
  target: CatalogAsset;
  nextParentId: string;
};

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const current = index;
      if (current >= items.length) return;
      index += 1;
      results[current] = await worker(items[current]);
    }
  });

  await Promise.all(runners);
  return results;
}

const planDirectParentAssignment = (
  assets: CatalogAsset[],
  targetIdRaw: string,
  parentIdRaw?: string | null
): DirectParentAssignmentPlan => {
  const targetId = normalizeId(targetIdRaw);
  if (!targetId) {
    throw new ParentAssignmentError(400, 'Asset ID is required.');
  }

  const nextParentId = normalizeId(parentIdRaw);
  const target = assets.find((asset) => asset.id === targetId);
  if (!target) {
    throw new ParentAssignmentError(404, 'Target asset was not found.');
  }

  if (nextParentId) {
    if (nextParentId === targetId) {
      throw new ParentAssignmentError(400, 'An asset cannot be its own parent.');
    }

    const parentExists = assets.some((asset) => asset.id === nextParentId);
    if (!parentExists) {
      throw new ParentAssignmentError(404, 'Parent asset was not found.');
    }
  }

  return {
    target,
    nextParentId,
  };
};

const applyDirectParentAssignment = async ({
  target,
  nextParentId,
}: DirectParentAssignmentPlan): Promise<AssignAssetParentResult> => {
  const targetId = target.id;

  if (target.assetType === 'image') {
    await patchCloudflareImageParent(targetId, nextParentId);
    const images = await getCachedImages(false);
    const cached = images.find((image) => image.id === targetId);
    if (cached) {
      upsertCachedImage({
        ...cached,
        parentId: nextParentId || undefined,
      });
    }
  } else {
    const updated = await updateVideoAssetRecord(targetId, {
      parentId: nextParentId || undefined,
    });
    if (!updated) {
      const existing = await getVideoAssetRecord(targetId);
      if (!existing) {
        throw new ParentAssignmentError(404, 'Target video was not found.');
      }
    }
  }

  return {
    targetId,
    targetAssetType: target.assetType,
    parentId: nextParentId || undefined,
    canonicalParentId: nextParentId || undefined,
  };
};

export async function setAssetParentDirectlyWithAssets(
  targetIdRaw: string,
  parentIdRaw: string | null | undefined,
  assets: CatalogAsset[]
): Promise<AssignAssetParentResult> {
  return applyDirectParentAssignment(
    planDirectParentAssignment(assets, targetIdRaw, parentIdRaw)
  );
}

export async function setAssetParentDirectly(
  targetIdRaw: string,
  parentIdRaw?: string | null,
  options?: { forceRefreshImages?: boolean }
): Promise<AssignAssetParentResult> {
  let usedForceRefresh = options?.forceRefreshImages === true;
  let assets = await listCatalogAssets({
    forceRefreshImages: usedForceRefresh,
    includeVideos: process.env.ENABLE_VIDEO_ASSETS === '1',
  });

  try {
    return await setAssetParentDirectlyWithAssets(targetIdRaw, parentIdRaw, assets);
  } catch (error) {
    const shouldRetryWithFreshCatalog =
      !usedForceRefresh &&
      error instanceof ParentAssignmentError &&
      (error.status === 404 || error.status === 400);

    if (!shouldRetryWithFreshCatalog) {
      throw error;
    }

    usedForceRefresh = true;
    assets = await listCatalogAssets({
      forceRefreshImages: true,
      includeVideos: process.env.ENABLE_VIDEO_ASSETS === '1',
    });

    return setAssetParentDirectlyWithAssets(targetIdRaw, parentIdRaw, assets);
  }
}

export async function detachAssetChildren(
  parentIdRaw: string,
  options?: {
    concurrency?: number;
    forceRefreshImages?: boolean;
    includeVideos?: boolean;
    requireCanonicalImageParent?: boolean;
    dryRun?: boolean;
  }
): Promise<DetachAssetChildrenResult> {
  const parentId = normalizeId(parentIdRaw);
  if (!parentId) {
    throw new ParentAssignmentError(400, 'Parent asset ID is required.');
  }

  const assets = await listCatalogAssets({
    forceRefreshImages: options?.forceRefreshImages === true,
    includeVideos: options?.includeVideos ?? process.env.ENABLE_VIDEO_ASSETS === '1',
  });
  const target = assets.find((asset) => asset.id === parentId);

  if (options?.requireCanonicalImageParent) {
    if (!target) {
      throw new ParentAssignmentError(404, 'Image not found');
    }
    if (target.assetType !== 'image') {
      throw new ParentAssignmentError(400, 'Only images can be family parents.');
    }
    if (normalizeId(target.parentId)) {
      throw new ParentAssignmentError(400, 'Detach-all can only be run on canonical parent images.');
    }
  }

  const childIds = assets
    .filter((asset) => normalizeId(asset.parentId) === parentId)
    .map((asset) => asset.id);
  const concurrency = Math.min(8, Math.max(1, options?.concurrency ?? 4));

  if (options?.dryRun || childIds.length === 0) {
    return {
      parentId,
      childIds,
      detachedIds: [],
      failed: [],
    };
  }

  const detachChild = async (id: string): Promise<DetachAssetChildrenOutcome> => {
    try {
      await setAssetParentDirectlyWithAssets(id, '', assets);
      return { ok: true, id };
    } catch (error) {
      const parentError = error instanceof ParentAssignmentError ? error : null;
      return {
        ok: false,
        id,
        status: parentError?.status ?? 500,
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  };

  const outcomes = await runWithConcurrency(childIds, concurrency, detachChild);
  const detachedIds = outcomes.filter((outcome) => outcome.ok).map((outcome) => outcome.id);
  const failed = outcomes
    .filter((outcome): outcome is { ok: false; id: string; status?: number; message?: string } => !outcome.ok)
    .map((outcome) => ({
      id: outcome.id,
      status: outcome.status ?? 500,
      message: outcome.message ?? 'Unknown error',
    }));

  return {
    parentId,
    childIds,
    detachedIds,
    failed,
  };
}

const reparentDirectChildren = async (
  assets: CatalogAsset[],
  targetId: string,
  nextParentId: string
): Promise<string[]> => {
  const directChildren = assets.filter((asset) => normalizeId(asset.parentId) === targetId);
  if (directChildren.length === 0) {
    return [];
  }

  const imageChildren = directChildren.filter((asset) => asset.assetType === 'image');
  const videoChildren = directChildren.filter((asset) => asset.assetType === 'video');

  const cachedImages = imageChildren.length > 0 ? await getCachedImages(false) : [];
  const cachedById = new Map(cachedImages.map((image) => [image.id, image]));
  const failures: string[] = [];

  for (const child of imageChildren) {
    try {
      await patchCloudflareImageParent(child.id, nextParentId);
      const cached = cachedById.get(child.id);
      if (cached) {
        upsertCachedImage({
          ...cached,
          parentId: nextParentId || undefined,
        });
      }
    } catch (error) {
      failures.push(`${child.id}: ${error instanceof Error ? error.message : 'Failed to re-parent image child'}`);
    }
  }

  for (const child of videoChildren) {
    try {
      const updated = await updateVideoAssetRecord(child.id, {
        parentId: nextParentId || undefined,
      });
      if (!updated) {
        failures.push(`${child.id}: Target video child was not found`);
      }
    } catch (error) {
      failures.push(`${child.id}: ${error instanceof Error ? error.message : 'Failed to re-parent video child'}`);
    }
  }

  if (failures.length > 0) {
    throw new ParentAssignmentError(
      502,
      `Failed to re-parent ${failures.length} existing child asset(s): ${failures.join('; ')}`
    );
  }

  return directChildren.map((child) => child.id);
};

export async function assignAssetParent(
  targetIdRaw: string,
  parentIdRaw?: string | null,
  options?: { forceRefreshImages?: boolean; allowTargetWithChildren?: boolean }
): Promise<AssignAssetParentResult> {
  const targetId = normalizeId(targetIdRaw);
  if (!targetId) {
    throw new ParentAssignmentError(400, 'Asset ID is required.');
  }

  const requestedParentId = normalizeId(parentIdRaw);
  let usedForceRefresh = options?.forceRefreshImages === true;
  let assets = await listCatalogAssets({
    forceRefreshImages: usedForceRefresh,
    includeVideos: process.env.ENABLE_VIDEO_ASSETS === '1',
  });
  let target = assets.find((asset) => asset.id === targetId);
  if (!target && !usedForceRefresh) {
    usedForceRefresh = true;
    assets = await listCatalogAssets({
      forceRefreshImages: true,
      includeVideos: process.env.ENABLE_VIDEO_ASSETS === '1',
    });
    target = assets.find((asset) => asset.id === targetId);
  }
  if (!target) {
    throw new ParentAssignmentError(404, 'Target asset was not found.');
  }

  let canonicalParentId = '';
  let redirectedFromParentId: string | undefined;
  let reparentedChildIds: string[] = [];

  if (requestedParentId) {
    if (!assets.some((asset) => asset.id === requestedParentId) && !usedForceRefresh) {
      usedForceRefresh = true;
      assets = await listCatalogAssets({
        forceRefreshImages: true,
        includeVideos: process.env.ENABLE_VIDEO_ASSETS === '1',
      });
      target = assets.find((asset) => asset.id === targetId);
      if (!target) {
        throw new ParentAssignmentError(404, 'Target asset was not found.');
      }
    }

    let resolved: { canonicalParentId: string; redirectedFromParentId?: string };
    try {
      resolved = resolveCanonicalAssetParent(assets, requestedParentId);
    } catch (error) {
      if (
        !usedForceRefresh &&
        error instanceof ParentAssignmentError &&
        error.status === 400
      ) {
        usedForceRefresh = true;
        assets = await listCatalogAssets({
          forceRefreshImages: true,
          includeVideos: process.env.ENABLE_VIDEO_ASSETS === '1',
        });
        target = assets.find((asset) => asset.id === targetId);
        if (!target) {
          throw new ParentAssignmentError(404, 'Target asset was not found.');
        }
        resolved = resolveCanonicalAssetParent(assets, requestedParentId);
      } else {
        throw error;
      }
    }

    canonicalParentId = resolved.canonicalParentId;
    redirectedFromParentId = resolved.redirectedFromParentId;

    if (targetId === canonicalParentId) {
      throw new ParentAssignmentError(400, 'An asset cannot be its own parent.');
    }

    const targetHasChildren = assets.some((asset) => normalizeId(asset.parentId) === targetId);
    if (targetHasChildren && options?.allowTargetWithChildren !== true) {
      if (target.assetType === 'video') {
        reparentedChildIds = await reparentDirectChildren(assets, targetId, canonicalParentId);
      } else {
        throw new ParentAssignmentError(
          400,
          'Cannot assign a parent to an asset that already has variations.'
        );
      }
    }
  }

  if (target.assetType === 'image') {
    await patchCloudflareImageParent(targetId, canonicalParentId);
    const images = await getCachedImages(false);
    const cached = images.find((image) => image.id === targetId);
    if (cached) {
      upsertCachedImage({
        ...cached,
        parentId: canonicalParentId || undefined,
      });
    }
  } else {
    const updated = await updateVideoAssetRecord(targetId, {
      parentId: canonicalParentId || undefined,
    });
    if (!updated) {
      const existing = await getVideoAssetRecord(targetId);
      if (!existing) {
        throw new ParentAssignmentError(404, 'Target video was not found.');
      }
    }
  }

  return {
    targetId,
    targetAssetType: target.assetType,
    parentId: canonicalParentId || undefined,
    canonicalParentId: canonicalParentId || undefined,
    redirectedFromParentId,
    reparentedChildIds: reparentedChildIds.length > 0 ? reparentedChildIds : undefined,
  };
}
