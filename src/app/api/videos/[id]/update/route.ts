import { NextRequest, NextResponse } from 'next/server';
import { cleanString } from '@/utils/cloudflareMetadata';
import { normalizeOriginalUrl } from '@/utils/urlNormalization';
import { upsertRegistryNamespace } from '@/server/namespaceRegistry';
import { getVideoAssetRecord, updateVideoAssetRecord } from '@/server/videoCatalogStorage';

type UpdateVideoBody = {
  folder?: string | null;
  tags?: string[] | string | null;
  description?: string | null;
  displayName?: string | null;
  originalUrl?: string | null;
  sourceUrl?: string | null;
  namespace?: string | null;
};

const hasOwn = (obj: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(obj, key);

const parseTags = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return Array.from(new Set(value
      .map((tag) => cleanString(typeof tag === 'string' ? tag : undefined))
      .filter((tag): tag is string => Boolean(tag))
    ));
  }
  if (typeof value === 'string') {
    return Array.from(new Set(value
      .split(',')
      .map((tag) => cleanString(tag))
      .filter((tag): tag is string => Boolean(tag))
    ));
  }
  return [];
};

const normalizeNamespace = (value?: string) => {
  const cleaned = cleanString(value);
  if (!cleaned || cleaned === '__all__' || cleaned === '__none__' || cleaned === 'undefined') {
    return undefined;
  }
  return cleaned;
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Video ID is required' }, { status: 400 });
    }

    const body = (await request.json()) as UpdateVideoBody;
    const bodyRecord = body as unknown as Record<string, unknown>;

    const existing = await getVideoAssetRecord(id);
    if (!existing) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    const patch: Parameters<typeof updateVideoAssetRecord>[1] = {};

    if (hasOwn(bodyRecord, 'folder')) {
      patch.folder = cleanString(typeof body.folder === 'string' ? body.folder : undefined);
    }

    if (hasOwn(bodyRecord, 'tags')) {
      patch.tags = parseTags(body.tags);
    }

    if (hasOwn(bodyRecord, 'description')) {
      patch.description = cleanString(typeof body.description === 'string' ? body.description : undefined);
    }

    if (hasOwn(bodyRecord, 'displayName')) {
      patch.displayName = cleanString(typeof body.displayName === 'string' ? body.displayName : undefined);
    }

    if (hasOwn(bodyRecord, 'originalUrl')) {
      patch.originalUrl = cleanString(typeof body.originalUrl === 'string' ? body.originalUrl : undefined);
    }

    if (hasOwn(bodyRecord, 'sourceUrl')) {
      patch.sourceUrl = cleanString(typeof body.sourceUrl === 'string' ? body.sourceUrl : undefined);
    }

    if (hasOwn(bodyRecord, 'namespace')) {
      const nextNamespace = normalizeNamespace(typeof body.namespace === 'string' ? body.namespace : undefined);
      patch.namespace = nextNamespace;
      if (nextNamespace) {
        await upsertRegistryNamespace(nextNamespace);
      }
    }

    const updated = await updateVideoAssetRecord(id, patch);
    if (!updated) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      id: updated.id,
      folder: updated.folder,
      tags: updated.tags,
      description: updated.description,
      displayName: updated.displayName || updated.filename,
      originalUrl: updated.originalUrl,
      originalUrlNormalized: normalizeOriginalUrl(updated.originalUrl),
      sourceUrl: updated.sourceUrl,
      sourceUrlNormalized: normalizeOriginalUrl(updated.sourceUrl),
      namespace: updated.namespace,
    });
  } catch (error) {
    console.error('[video update] failed', error);
    return NextResponse.json({ error: 'Failed to update video metadata' }, { status: 500 });
  }
}
