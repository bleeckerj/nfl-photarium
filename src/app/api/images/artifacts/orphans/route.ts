import { NextRequest, NextResponse } from 'next/server';
import {
  auditOrphanedImageArtifacts,
  cleanupOrphanedImageArtifacts,
  type OrphanArtifactTarget,
} from '@/server/imageArtifactOrphanCleanup';

const VALID_TARGETS: OrphanArtifactTarget[] = ['imageExtras', 'workflowIntentEmbedding'];

function parseTargets(value: string | null): OrphanArtifactTarget[] | null {
  if (!value) return null;
  const targets = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (targets.length === 0) return null;
  return targets.filter((target): target is OrphanArtifactTarget =>
    (VALID_TARGETS as string[]).includes(target)
  );
}

type CleanupBody = {
  apply?: boolean;
  confirm?: string;
  refreshCloudflareCache?: boolean;
  targets?: OrphanArtifactTarget[];
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const refreshCloudflareCache = searchParams.get('refresh') !== '0';
    const targets = parseTargets(searchParams.get('targets'));

    const report = await auditOrphanedImageArtifacts({
      refreshCloudflareCache,
      targets: targets ?? undefined,
    });

    return NextResponse.json({ success: true, apply: false, report });
  } catch (error) {
    console.error('[OrphanCleanup] Audit failed', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to audit orphaned image artifacts' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    let body: CleanupBody = {};
    try {
      body = (await request.json()) as CleanupBody;
    } catch {
      body = {};
    }

    const apply = body.apply === true;
    if (apply && body.confirm !== 'CLEANUP_ORPHANED_IMAGE_ARTIFACTS') {
      return NextResponse.json(
        {
          error:
            'Confirmation required. Set { apply: true, confirm: "CLEANUP_ORPHANED_IMAGE_ARTIFACTS" }.',
        },
        { status: 400 }
      );
    }

    const report = await cleanupOrphanedImageArtifacts({
      apply,
      refreshCloudflareCache: body.refreshCloudflareCache ?? true,
      targets: body.targets,
    });

    return NextResponse.json({ success: true, apply, report });
  } catch (error) {
    console.error('[OrphanCleanup] Cleanup failed', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to cleanup orphaned image artifacts' },
      { status: 500 }
    );
  }
}

