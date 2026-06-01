import { NextRequest, NextResponse } from 'next/server';
import { detachAssetChildren, ParentAssignmentError } from '@/server/assetParentService';

type DetachChildrenRequestBody = {
  concurrency?: number;
  dryRun?: boolean;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startedAt = Date.now();
  const { id: requestedId } = await params;

  if (!requestedId) {
    return NextResponse.json({ error: 'Image ID is required' }, { status: 400 });
  }

  let body: DetachChildrenRequestBody = {};
  try {
    body = await request.json();
  } catch {
    // empty body ok
  }

  const dryRun = body.dryRun === true;
  const concurrency = Math.min(
    8,
    Math.max(1, Number.isFinite(body.concurrency) ? (body.concurrency as number) : 4)
  );

  let result;
  try {
    result = await detachAssetChildren(requestedId, {
      concurrency,
      forceRefreshImages: true,
      includeVideos: process.env.ENABLE_VIDEO_ASSETS === '1',
      requireCanonicalImageParent: true,
      dryRun,
    });
  } catch (error) {
    const parentError = error instanceof ParentAssignmentError ? error : null;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to detach children' },
      { status: parentError?.status ?? 500 }
    );
  }

  if (dryRun) {
    return NextResponse.json({
      requestedId,
      concurrency,
      childIds: result.childIds,
      count: result.childIds.length,
      dryRun: true,
    });
  }

  return NextResponse.json(
    {
      success: result.failed.length === 0,
      requestedId,
      attempted: result.childIds.length,
      detachedIds: result.detachedIds,
      failed: result.failed,
      concurrency,
      timingMs: Date.now() - startedAt,
    },
    { status: result.failed.length === 0 ? 200 : 207 }
  );
}
