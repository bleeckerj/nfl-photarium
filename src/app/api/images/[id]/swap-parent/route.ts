import { NextRequest, NextResponse } from 'next/server';
import { getCachedImages, upsertCachedImage } from '@/server/cloudflareImageCache';
import { getCloudflareCredentials } from '@/server/cloudflareClient';
import { listImageFamilyIds } from '@/server/imageFamily';
import { pickCloudflareMetadata } from '@/utils/cloudflareMetadata';

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

  const concurrency = Math.min(
    8,
    Math.max(1, Number.isFinite(body.concurrency) ? (body.concurrency as number) : 3)
  );
  const dryRun = body.dryRun === true;

  const images = await getCachedImages(true);
  const target = images.find((img) => img.id === requestedId);
  if (!target) {
    return NextResponse.json({ error: 'Image not found' }, { status: 404 });
  }

  const newParent = images.find((img) => img.id === newParentId);
  if (!newParent) {
    return NextResponse.json({ error: 'New parent not found' }, { status: 404 });
  }

  const { rootId, memberIds } = listImageFamilyIds(images, requestedId);
  if (!memberIds.includes(newParentId)) {
    return NextResponse.json(
      { error: 'New parent must be in the same family' },
      { status: 400 }
    );
  }

  const updatedAt = new Date().toISOString();
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
      concurrency,
      dryRun: true
    });
  }

  let credentials: { accountId: string; apiToken: string };
  try {
    credentials = getCloudflareCredentials();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Cloudflare credentials not configured' },
      { status: 500 }
    );
  }

  const patchParent = async ({ id, parentId }: { id: string; parentId: string }): Promise<SwapOutcome> => {
    try {
      const metadataPayload = pickCloudflareMetadata(
        {
          variationParentId: parentId,
          updatedAt
        },
        { includeEmpty: true }
      );

      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${credentials.accountId}/images/v1/${id}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${credentials.apiToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ metadata: metadataPayload })
        }
      );

      const result = await response.json().catch(() => null);
      if (!response.ok) {
        return {
          ok: false,
          id,
          parentId,
          status: response.status,
          message:
            result?.errors?.[0]?.message || result?.error || 'Failed to update image metadata'
        };
      }

      const cached = images.find((img) => img.id === id);
      if (cached) {
        upsertCachedImage({
          ...cached,
          parentId: parentId || undefined
        });
      }

      return { ok: true, id, parentId };
    } catch (error) {
      return {
        ok: false,
        id,
        parentId,
        status: 500,
        message: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  };

  const outcomes = await runWithConcurrency(updates, concurrency, patchParent);
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