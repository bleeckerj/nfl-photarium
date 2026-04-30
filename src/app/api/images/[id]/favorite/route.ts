import { NextRequest, NextResponse } from 'next/server';
import {
  enforceCloudflareMetadataLimit,
  omitExtrasOnlyCloudflareMetadata,
  parseCloudflareMetadata,
  pickCloudflareMetadata,
} from '@/utils/cloudflareMetadata';
import { hasFavoriteTag, setFavoriteTag } from '@/utils/systemTags';
import { transformApiImageToCached, upsertCachedImage } from '@/server/cloudflareImageCache';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;

    if (!accountId || !apiToken) {
      return NextResponse.json({ error: 'Cloudflare credentials not configured' }, { status: 500 });
    }

    const { id: imageId } = await params;
    if (!imageId) {
      return NextResponse.json({ error: 'Image ID is required' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    if (typeof body?.favorite !== 'boolean') {
      return NextResponse.json({ error: 'favorite must be a boolean' }, { status: 400 });
    }

    const fetchedImageResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1/${imageId}`,
      {
        headers: {
          Authorization: `Bearer ${apiToken}`,
        },
      }
    );
    const fetchedImageResult = await fetchedImageResponse.json();

    if (!fetchedImageResponse.ok) {
      return NextResponse.json(
        { error: fetchedImageResult.errors?.[0]?.message || 'Failed to fetch image from Cloudflare' },
        { status: fetchedImageResponse.status }
      );
    }

    const existingMeta = parseCloudflareMetadata(fetchedImageResult.result?.meta);
    const existingTags = Array.isArray(existingMeta.tags)
      ? existingMeta.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
      : [];
    const nextTags = setFavoriteTag(existingTags, body.favorite);
    const metadataPayload = pickCloudflareMetadata(
      omitExtrasOnlyCloudflareMetadata({
        ...existingMeta,
        tags: nextTags,
        updatedAt: new Date().toISOString(),
      }),
      { includeEmpty: true }
    );

    const metadataLimit = enforceCloudflareMetadataLimit(metadataPayload, 1024);
    if (metadataLimit.dropped.includes('tags')) {
      return NextResponse.json(
        { error: 'Metadata exceeds Cloudflare 1024-byte limit. Could not apply fields: tags' },
        { status: 400 }
      );
    }

    const finalMetadataPayload = metadataLimit.metadata;
    const updateResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1/${imageId}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ metadata: finalMetadataPayload }),
      }
    );
    const updateResult = await updateResponse.json();

    if (!updateResponse.ok) {
      return NextResponse.json(
        { error: updateResult.errors?.[0]?.message || 'Failed to update favorite' },
        { status: updateResponse.status }
      );
    }

    const cachedImage = transformApiImageToCached({
      id: fetchedImageResult.result.id,
      filename: fetchedImageResult.result.filename,
      uploaded: fetchedImageResult.result.uploaded,
      variants: fetchedImageResult.result.variants,
      size: fetchedImageResult.result.size,
      meta: finalMetadataPayload,
    });
    upsertCachedImage(cachedImage);

    const finalTags = Array.isArray(finalMetadataPayload.tags) ? finalMetadataPayload.tags : nextTags;
    return NextResponse.json({
      success: true,
      favorite: hasFavoriteTag(finalTags),
      tags: finalTags,
    });
  } catch (error) {
    console.error('Favorite image error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
