import { NextRequest, NextResponse } from 'next/server';
import { listCatalogAssets } from '@/server/assetCatalog';
import {
  ParentAssignmentError,
  setAssetParentDirectlyWithAssets,
} from '@/server/assetParentService';
import { listImageFamilyIds } from '@/server/imageFamily';
import type { CatalogAsset } from '@/server/assetCatalog';

type SwapParentRequestBody = {
  newParentId?: string;
  concurrency?: number;
  dryRun?: boolean;
};

type SwapOutcome = {
  ok: boolean;
  id: string;
  status?: number;
  message?: string;
  parentId?: string;
};

const DEFAULT_SWAP_CONCURRENCY = 12;

class SwapValidationError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const normalizeConcurrency = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SWAP_CONCURRENCY;
  return Math.max(1, Math.min(12, Math.trunc(value)));
};

const mapWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> => {
  if (items.length === 0) return [];

  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const runWorker = async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) {
        return;
      }
      results[currentIndex] = await worker(items[currentIndex]);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker())
  );

  return results;
};

const buildSwapPlan = (
  assets: CatalogAsset[],
  requestedId: string,
  newParentId: string
) => {
  const target = assets.find((asset) => asset.id === requestedId);
  if (!target) {
    throw new SwapValidationError(404, 'Image not found');
  }
  if (target.assetType !== 'image') {
    throw new SwapValidationError(400, 'Only images can be family parents.');
  }
  if (target.parentId) {
    throw new SwapValidationError(
      400,
      'Only root images can be swapped. Open the parent image to swap variants.'
    );
  }

  const newParent = assets.find((asset) => asset.id === newParentId);
  if (!newParent) {
    throw new SwapValidationError(404, 'New parent not found');
  }
  if (newParent.assetType !== 'image') {
    throw new SwapValidationError(
      400,
      'New parent must be an image. Videos can only be variations.'
    );
  }

  const { rootId, memberIds } = listImageFamilyIds(assets, requestedId);
  if (!memberIds.includes(newParentId)) {
    throw new SwapValidationError(400, 'New parent must be in the same family');
  }

  return {
    rootId,
    memberIds,
    updates: memberIds.map((id) => ({
      id,
      parentId: id === newParentId ? '' : newParentId,
    })),
  };
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestStartedAt = Date.now();
  const { id: requestedId } = await params;

  if (!requestedId) {
    return NextResponse.json({ error: 'Image ID is required' }, { status: 400 });
  }

  let body: SwapParentRequestBody = {};
  try {
    body = await request.json();
  } catch {
    // empty body ok
  }

  const newParentId = typeof body.newParentId === 'string' ? body.newParentId.trim() : '';
  if (!newParentId) {
    return NextResponse.json({ error: 'newParentId is required' }, { status: 400 });
  }

  const dryRun = body.dryRun === true;
  const concurrency = normalizeConcurrency(body.concurrency);

  const catalogLoadStartedAt = Date.now();
  let usedForceRefresh = false;
  let assets = await listCatalogAssets({
    forceRefreshImages: false,
    includeVideos: process.env.ENABLE_VIDEO_ASSETS === '1',
  });
  let plan;
  try {
    plan = buildSwapPlan(assets, requestedId, newParentId);
  } catch (error) {
    if (!(error instanceof SwapValidationError)) {
      throw error;
    }

    usedForceRefresh = true;
    assets = await listCatalogAssets({
      forceRefreshImages: true,
      includeVideos: process.env.ENABLE_VIDEO_ASSETS === '1',
    });

    try {
      plan = buildSwapPlan(assets, requestedId, newParentId);
    } catch (retryError) {
      if (retryError instanceof SwapValidationError) {
        return NextResponse.json({ error: retryError.message }, { status: retryError.status });
      }
      throw retryError;
    }
  }
  const catalogLoadMs = Date.now() - catalogLoadStartedAt;
  const { rootId, memberIds, updates } = plan;

  if (dryRun) {
    return NextResponse.json({
      requestedId,
      rootId,
      newParentId,
      memberIds,
      updates,
      dryRun: true
    });
  }

  const patchParent = async ({ id, parentId }: { id: string; parentId: string }): Promise<SwapOutcome> => {
    try {
      await setAssetParentDirectlyWithAssets(id, parentId, assets);
      return { ok: true, id, parentId };
    } catch (error) {
      const parentError = error instanceof ParentAssignmentError ? error : null;
      return {
        ok: false,
        id,
        parentId,
        status: parentError?.status ?? 500,
        message: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  };

  const updateStartedAt = Date.now();
  const promotedOutcome = await patchParent({ id: newParentId, parentId: '' });
  if (!promotedOutcome.ok) {
    console.info('[swap-parent] promotion failed', {
      requestedId,
      rootId,
      newParentId,
      familySize: memberIds.length,
      catalogLoadMs,
      updateMs: Date.now() - updateStartedAt,
      totalMs: Date.now() - requestStartedAt,
      usedForceRefresh,
      status: promotedOutcome.status ?? 500,
    });
    return NextResponse.json(
      {
        success: false,
        requestedId,
        rootId,
        newParentId,
        updated: [],
        failed: [promotedOutcome],
      },
      { status: promotedOutcome.status ?? 500 }
    );
  }

  const remainingUpdates = updates.filter((update) => update.id !== newParentId);
  const remainingOutcomes = await mapWithConcurrency(remainingUpdates, concurrency, patchParent);
  const outcomes = [promotedOutcome, ...remainingOutcomes];
  const failed = outcomes.filter((o) => !o.ok);
  const updateMs = Date.now() - updateStartedAt;

  console.info('[swap-parent] completed', {
    requestedId,
    rootId,
    newParentId,
    familySize: memberIds.length,
    catalogLoadMs,
    updateMs,
    totalMs: Date.now() - requestStartedAt,
    usedForceRefresh,
    concurrency,
    failedCount: failed.length,
  });

  return NextResponse.json({
    success: failed.length === 0,
    requestedId,
    rootId,
    newParentId,
    concurrency,
    updated: outcomes.filter((o) => o.ok).map((o) => o.id),
    failed
  }, { status: failed.length === 0 ? 200 : 207 });
}

