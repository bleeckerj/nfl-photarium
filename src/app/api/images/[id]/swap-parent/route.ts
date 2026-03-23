import { NextRequest, NextResponse } from 'next/server';
import { listCatalogAssets } from '@/server/assetCatalog';
import {
  ParentAssignmentError,
  setAssetParentDirectly,
} from '@/server/assetParentService';
import { listImageFamilyIds } from '@/server/imageFamily';

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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const assets = await listCatalogAssets({
    forceRefreshImages: true,
    includeVideos: process.env.ENABLE_VIDEO_ASSETS === '1',
  });
  const target = assets.find((asset) => asset.id === requestedId);
  if (!target) {
    return NextResponse.json({ error: 'Image not found' }, { status: 404 });
  }
  if (target.assetType !== 'image') {
    return NextResponse.json({ error: 'Only images can be family parents.' }, { status: 400 });
  }

  const newParent = assets.find((asset) => asset.id === newParentId);
  if (!newParent) {
    return NextResponse.json({ error: 'New parent not found' }, { status: 404 });
  }
  if (newParent.assetType !== 'image') {
    return NextResponse.json(
      { error: 'New parent must be an image. Videos can only be variations.' },
      { status: 400 }
    );
  }

  const { rootId, memberIds } = listImageFamilyIds(assets, requestedId);
  if (!memberIds.includes(newParentId)) {
    return NextResponse.json(
      { error: 'New parent must be in the same family' },
      { status: 400 }
    );
  }

  const updates = memberIds.map((id) => ({
    id,
    parentId: id === newParentId ? '' : newParentId
  }));

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
      await setAssetParentDirectly(id, parentId);
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

  const promotedOutcome = await patchParent({ id: newParentId, parentId: '' });
  if (!promotedOutcome.ok) {
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
