import { NextRequest, NextResponse } from 'next/server';
import {
  ExifPropagationError,
  normalizeExifPropagationMode,
  propagateImageExif,
} from '@/server/exifPropagationService';

type PushExifRequestBody = {
  mode?: unknown;
  dryRun?: unknown;
  concurrency?: unknown;
};

/**
 * Push this image's EXIF onto the rest of its family: a parent pushes to its
 * variants, a variant pushes to its parent and siblings. Default mode only
 * fills members that have no EXIF yet; `mode: "overwrite"` replaces theirs.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startedAt = Date.now();
  const { id: requestedId } = await params;

  if (!requestedId) {
    return NextResponse.json({ error: 'Image ID is required' }, { status: 400 });
  }

  let body: PushExifRequestBody = {};
  try {
    const parsed = await request.json();
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      body = parsed as PushExifRequestBody;
    }
  } catch {
    // empty body ok
  }

  const mode = normalizeExifPropagationMode(body.mode);
  const dryRun = body.dryRun === true;
  const concurrency = Math.min(
    8,
    Math.max(1, typeof body.concurrency === 'number' && Number.isFinite(body.concurrency) ? body.concurrency : 4)
  );

  let result;
  try {
    // The cache already carries local parent/child mutations, and a forced
    // Cloudflare refresh added ~4s per click without changing the target set.
    result = await propagateImageExif(requestedId, { mode, dryRun, concurrency });
  } catch (error) {
    const propagationError = error instanceof ExifPropagationError ? error : null;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to push EXIF' },
      { status: propagationError?.status ?? 500 }
    );
  }

  return NextResponse.json(
    {
      success: result.failed.length === 0,
      requestedId,
      relation: result.relation,
      familyRootId: result.familyRootId,
      mode: result.mode,
      dryRun: result.dryRun,
      exif: result.exif,
      targetIds: result.targetIds,
      updatedIds: result.updatedIds,
      skipped: result.skipped,
      failed: result.failed,
      concurrency,
      timingMs: Date.now() - startedAt,
    },
    { status: result.failed.length === 0 ? 200 : 207 }
  );
}
