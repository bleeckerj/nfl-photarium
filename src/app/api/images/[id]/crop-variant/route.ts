import { NextRequest, NextResponse } from 'next/server';
import {
  createCropVariant,
  normalizeCropAnchor,
  normalizeCropQuality,
  type CropVariantAnchor,
} from '@/server/cropVariantService';

function normalizeTags(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const tags = value
    .map((tag) => (typeof tag === 'string' ? tag.trim() : ''))
    .filter(Boolean);
  return tags.length ? Array.from(new Set(tags)) : undefined;
}

function statusForCropError(error: unknown) {
  const status = typeof error === 'object' && error && 'status' in error
    ? Number((error as { status?: unknown }).status)
    : undefined;
  if (status && Number.isFinite(status)) {
    return status;
  }

  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (
    message.includes('aspect ratio') ||
    message.includes('source image dimensions') ||
    message.includes('requested') ||
    message.includes('image id is required')
  ) {
    return 400;
  }
  return 500;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: imageId } = await params;
    if (!imageId) {
      return NextResponse.json({ error: 'Image ID is required' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const anchor = normalizeCropAnchor(
      typeof body?.anchor === 'string' ? body.anchor : undefined
    ) as CropVariantAnchor;
    const result = await createCropVariant({
      imageId,
      aspectRatio: typeof body?.aspectRatio === 'string' ? body.aspectRatio : undefined,
      anchor,
      quality: normalizeCropQuality(Number(body?.quality)),
      filename: typeof body?.filename === 'string' ? body.filename : undefined,
      description: typeof body?.description === 'string' ? body.description : undefined,
      tags: normalizeTags(body?.tags),
      folder: typeof body?.folder === 'string' ? body.folder : undefined,
      namespace: typeof body?.namespace === 'string' ? body.namespace : undefined,
      parentId: typeof body?.parentId === 'string' ? body.parentId : undefined,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create crop variant';
    const status = statusForCropError(error);
    console.error('[CropVariant] failed', error);
    return NextResponse.json({ error: message }, { status });
  }
}
