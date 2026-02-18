import { NextRequest, NextResponse } from 'next/server';
import { getCachedImages, upsertCachedImage } from '@/server/cloudflareImageCache';
import { getCloudflareCredentials } from '@/server/cloudflareClient';
import { pickCloudflareMetadata } from '@/utils/cloudflareMetadata';

type DetachChildrenRequestBody = {
  concurrency?: number;
  dryRun?: boolean;
};

type DetachOutcome = {
  ok: boolean;
  id: string;
  status?: number;
  message?: string;
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

  const images = await getCachedImages(true);
  const target = images.find((img) => img.id === requestedId);
  if (!target) {
    return NextResponse.json({ error: 'Image not found' }, { status: 404 });
  }

  if (target.parentId) {
    return NextResponse.json(
      { error: 'Detach-all can only be run on canonical parent images.' },
      { status: 400 }
    );
  }

  const childIds = images.filter((img) => img.parentId === requestedId).map((img) => img.id);

  if (dryRun) {
    return NextResponse.json({
      requestedId,
      concurrency,
      childIds,
      count: childIds.length,
      dryRun: true,
    });
  }

  if (childIds.length === 0) {
    return NextResponse.json({
      success: true,
      requestedId,
      attempted: 0,
      detachedIds: [],
      failed: [],
      concurrency,
      timingMs: Date.now() - startedAt,
    });
  }

  const { accountId, apiToken } = getCloudflareCredentials();
  const updatedAt = new Date().toISOString();

  const detachChild = async (id: string): Promise<DetachOutcome> => {
    try {
      const metadataPayload = pickCloudflareMetadata(
        {
          variationParentId: '',
          updatedAt,
        },
        { includeEmpty: true }
      );

      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1/${id}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ metadata: metadataPayload }),
        }
      );

      const result = await response.json().catch(() => null);
      if (!response.ok) {
        return {
          ok: false,
          id,
          status: response.status,
          message:
            result?.errors?.[0]?.message || result?.error || 'Failed to update image metadata',
        };
      }

      const cached = images.find((img) => img.id === id);
      if (cached) {
        upsertCachedImage({
          ...cached,
          parentId: undefined,
        });
      }

      return { ok: true, id };
    } catch (error) {
      return {
        ok: false,
        id,
        status: 500,
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  };

  const outcomes = await runWithConcurrency(childIds, concurrency, detachChild);
  const detachedIds = outcomes.filter((o) => o.ok).map((o) => o.id);
  const failed = outcomes
    .filter((o): o is { ok: false; id: string; status?: number; message?: string } => !o.ok)
    .map((o) => ({ id: o.id, status: o.status ?? 500, message: o.message ?? 'Unknown error' }));

  return NextResponse.json(
    {
      success: failed.length === 0,
      requestedId,
      attempted: childIds.length,
      detachedIds,
      failed,
      concurrency,
      timingMs: Date.now() - startedAt,
    },
    { status: failed.length === 0 ? 200 : 207 }
  );
}
