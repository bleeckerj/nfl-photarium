import { NextRequest, NextResponse } from 'next/server';
import { getCachedImages } from '@/server/cloudflareImageCache';
import { getCloudflareCredentials } from '@/server/cloudflareClient';
import { cleanupImageArtifacts } from '@/server/imageArtifactCleanup';
import { isVectorSearchAvailable } from '@/server/vectorSearch';
import { listImageFamilyIds } from '@/server/imageFamily';
import {
  bumpDeleteFamilyJobAttempt,
  completeDeleteFamilyJob,
  createDeleteFamilyJob,
} from '@/server/deleteFamilyJobs';

type DeleteFamilyRequestBody = {
  /** Required unless dryRun=true */
  confirm?: string;
  /** If true, returns which ids would be deleted without deleting */
  dryRun?: boolean;
  /** Max concurrent Cloudflare deletes (default: 3) */
  concurrency?: number;
  /** If true, runs in background and returns a jobId for polling progress */
  async?: boolean;
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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startedAt = Date.now();
  const { id: requestedId } = await params;

  if (!requestedId) {
    return NextResponse.json({ error: 'Image ID is required' }, { status: 400 });
  }

  let body: DeleteFamilyRequestBody = {};
  try {
    body = await request.json();
  } catch {
    // empty body ok
  }

  const dryRun = body.dryRun === true;
  const asyncMode = body.async === true;
  const concurrency = Math.min(
    8,
    Math.max(1, Number.isFinite(body.concurrency) ? (body.concurrency as number) : 3)
  );
  if (!dryRun && body.confirm !== 'DELETE_FAMILY') {
    return NextResponse.json(
      { error: 'Confirmation required. Set { confirm: "DELETE_FAMILY" }.' },
      { status: 400 }
    );
  }

  // Refresh cache so we have the best chance of including all variants.
  const images = await getCachedImages(true);
  const target = images.find((img) => img.id === requestedId);
  if (!target) {
    return NextResponse.json({ error: 'Image not found' }, { status: 404 });
  }

  const { rootId, memberIds } = listImageFamilyIds(images, requestedId);

  if (dryRun) {
    return NextResponse.json({
      rootId,
      requestedId,
      memberIds,
      count: memberIds.length,
      concurrency,
      async: asyncMode,
    });
  }

  const { accountId, apiToken } = getCloudflareCredentials();

  const redisAvailable = await isVectorSearchAvailable().catch(() => false);

  const performDelete = async (imageId: string): Promise<{ ok: boolean; id: string; status?: number; message?: string }> => {
    try {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1/${imageId}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${apiToken}`,
          },
        }
      );

      if (response.status === 404) {
        const cleanup = await cleanupImageArtifacts(imageId, {
          includeVectors: redisAvailable,
          includeWorkflowIntentEmbedding: true,
        });
        if (!cleanup.success) {
          console.warn('[DeleteFamily] Local artifact cleanup had failures (404 path)', {
            imageId,
            steps: cleanup.steps,
          });
        }
        return { ok: true, id: imageId };
      }

      const result = await response.json().catch(() => null);
      if (!response.ok) {
        return {
          ok: false,
          id: imageId,
          status: response.status,
          message:
            result?.errors?.[0]?.message ||
            result?.error ||
            'Failed to delete image from Cloudflare',
        };
      }

      const cleanup = await cleanupImageArtifacts(imageId, {
        includeVectors: redisAvailable,
        includeWorkflowIntentEmbedding: true,
      });
      if (!cleanup.success) {
        console.warn('[DeleteFamily] Local artifact cleanup had failures', {
          imageId,
          steps: cleanup.steps,
        });
      }

      return { ok: true, id: imageId };
    } catch (error) {
      return {
        ok: false,
        id: imageId,
        status: 500,
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  };

  if (asyncMode) {
    const job = createDeleteFamilyJob({
      requestedId,
      rootId,
      total: memberIds.length,
      concurrency,
      vectorsDeleted: redisAvailable,
    });

    // Fire-and-forget background deletion; UI polls job status.
    void (async () => {
      try {
        await runWithConcurrency(memberIds, concurrency, async (imageId) => {
          const outcome = await performDelete(imageId);
          bumpDeleteFamilyJobAttempt(job.jobId, {
            ok: outcome.ok,
            error: outcome.ok ? undefined : outcome.message,
          });
          return outcome;
        });

        completeDeleteFamilyJob(job.jobId, true);
      } catch (error) {
        completeDeleteFamilyJob(
          job.jobId,
          false,
          error instanceof Error ? error.message : 'Unknown error'
        );
      }
    })();

    return NextResponse.json(
      {
        accepted: true,
        jobId: job.jobId,
        requestedId,
        rootId,
        total: memberIds.length,
        concurrency,
      },
      { status: 202 }
    );
  }

  const outcomes = await runWithConcurrency(memberIds, concurrency, performDelete);

  const deletedIds = outcomes.filter((o) => o.ok).map((o) => o.id);
  const failed = outcomes
    .filter((o): o is { ok: false; id: string; status?: number; message?: string } => !o.ok)
    .map((o) => ({ id: o.id, status: o.status ?? 500, message: o.message ?? 'Unknown error' }));

  return NextResponse.json({
    success: failed.length === 0,
    rootId,
    requestedId,
    attempted: memberIds.length,
    deletedIds,
    failed,
    vectorsDeleted: redisAvailable,
    concurrency,
    timingMs: Date.now() - startedAt,
  });
}
