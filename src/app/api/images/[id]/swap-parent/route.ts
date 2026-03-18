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
      await setAssetParentDirectly(id, parentId, { forceRefreshImages: true });
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
  const outcomes = [promotedOutcome];
  for (const update of remainingUpdates) {
    outcomes.push(await patchParent(update));
  }
  const failed = outcomes.filter((o) => !o.ok);

  return NextResponse.json({
    success: failed.length === 0,
    requestedId,
    rootId,
    newParentId,
    updated: outcomes.filter((o) => o.ok).map((o) => o.id),
    failed
  }, { status: failed.length === 0 ? 200 : 207 });
}
