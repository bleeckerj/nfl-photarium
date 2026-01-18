import { NextRequest, NextResponse } from 'next/server';
import { cleanString, parseCloudflareMetadata, pickCloudflareMetadata } from '@/utils/cloudflareMetadata';
import { normalizeOriginalUrl } from '@/utils/urlNormalization';
import { transformApiImageToCached, upsertCachedImage } from '@/server/cloudflareImageCache';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Check for required environment variables
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;
    
    if (!accountId || !apiToken) {
      return NextResponse.json(
        { error: 'Cloudflare credentials not configured' },
        { status: 500 }
      );
    }

    const { id: imageId } = await params;
    const body = await request.json();
    const { folder, tags, description, originalUrl, sourceUrl, parentId, displayName, altTag, variationSort, clearExif } = body;
    
    if (!imageId) {
      return NextResponse.json(
        { error: 'Image ID is required' },
        { status: 400 }
      );
    }

    const folderProvided = Object.prototype.hasOwnProperty.call(body, 'folder');
    const tagsProvided = Object.prototype.hasOwnProperty.call(body, 'tags');
    const descriptionProvided = Object.prototype.hasOwnProperty.call(body, 'description');
    const originalUrlProvided = Object.prototype.hasOwnProperty.call(body, 'originalUrl');
    const sourceUrlProvided = Object.prototype.hasOwnProperty.call(body, 'sourceUrl');
    const displayNameProvided = Object.prototype.hasOwnProperty.call(body, 'displayName');
    const altTagProvided = Object.prototype.hasOwnProperty.call(body, 'altTag');
    const variationSortProvided = Object.prototype.hasOwnProperty.call(body, 'variationSort');
    const clearExifProvided = Object.prototype.hasOwnProperty.call(body, 'clearExif');

    const cleanFolder = cleanString(typeof folder === 'string' ? folder : undefined);
    const cleanDescription =
      typeof description === 'string'
        ? cleanString(description)
        : description === null
          ? ''
          : undefined;
    const cleanOriginalUrl = cleanString(typeof originalUrl === 'string' ? originalUrl : undefined);
    const cleanSourceUrl = cleanString(typeof sourceUrl === 'string' ? sourceUrl : undefined);
    const cleanDisplayName = cleanString(typeof displayName === 'string' ? displayName : undefined);
    const cleanAltTag = cleanString(typeof altTag === 'string' ? altTag : undefined);
    const cleanVariationSort = (() => {
      if (typeof variationSort === 'number' && Number.isFinite(variationSort)) {
        return variationSort;
      }
      if (typeof variationSort === 'string') {
        const parsed = Number(variationSort);
        return Number.isFinite(parsed) ? parsed : undefined;
      }
      return undefined;
    })();
    const cleanTags = (() => {
      if (Array.isArray(tags)) {
        return tags
          .map((t: string) => cleanString(t))
          .filter((t): t is string => typeof t === 'string');
      }
      if (typeof tags === 'string') {
        return tags
          .split(',')
          .map(tag => cleanString(tag))
          .filter((t): t is string => typeof t === 'string');
      }
      return [];
    })();

    const fetchedImageResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1/${imageId}`,
      {
        headers: {
          'Authorization': `Bearer ${apiToken}`,
        },
      }
    );

    const fetchedImageResult = await fetchedImageResponse.json();

    if (!fetchedImageResponse.ok) {
      console.error('Cloudflare API error (fetch existing image):', fetchedImageResult);
      return NextResponse.json(
        { error: fetchedImageResult.errors?.[0]?.message || 'Failed to fetch existing image metadata' },
        { status: fetchedImageResponse.status }
      );
    }

    const existingMeta = parseCloudflareMetadata(fetchedImageResult.result?.meta);
    const parentProvided = Object.prototype.hasOwnProperty.call(body, 'parentId');
    const cleanParentId = cleanString(typeof parentId === 'string' ? parentId : '');

    const metadata = {
      ...existingMeta,
      updatedAt: new Date().toISOString(),
    } as Record<string, unknown>;

    if (folderProvided) {
      metadata.folder = cleanFolder;
    }

    if (tagsProvided) {
      metadata.tags = cleanTags;
    }

    if (descriptionProvided) {
      metadata.description = cleanDescription ?? '';
    }

    if (originalUrlProvided) {
      metadata.originalUrl = cleanOriginalUrl ?? '';
      metadata.originalUrlNormalized = normalizeOriginalUrl(cleanOriginalUrl) ?? '';
    }

    if (sourceUrlProvided) {
      metadata.sourceUrl = cleanSourceUrl ?? '';
      metadata.sourceUrlNormalized = normalizeOriginalUrl(cleanSourceUrl) ?? '';
    }

    if (displayNameProvided) {
      metadata.displayName = cleanDisplayName ?? '';
    }

    if (parentProvided) {
      metadata.variationParentId = cleanParentId;
    }

    if (altTagProvided) {
      metadata.altTag = cleanAltTag ?? '';
    }

    if (variationSortProvided && cleanVariationSort !== undefined) {
      metadata.variationSort = cleanVariationSort;
    }

    // Clear EXIF data if explicitly requested
    if (clearExifProvided && clearExif === true) {
      delete metadata.exif;
    }

    const metadataPayload = pickCloudflareMetadata(metadata);

    // Update image metadata in Cloudflare using JSON body
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1/${imageId}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ metadata: metadataPayload }),
      }
    );

    const result = await response.json();

    if (!response.ok) {
      console.error('Cloudflare API error:', result);
      return NextResponse.json(
        { error: result.errors?.[0]?.message || 'Failed to update image metadata' },
        { status: response.status }
      );
    }

    const finalParentId = metadataPayload.variationParentId as string | undefined;

    const finalFolder = metadataPayload.folder as string | undefined;
    const finalTags = Array.isArray(metadataPayload.tags) ? metadataPayload.tags : [];
    const finalDescription = metadataPayload.description as string | undefined;
    const finalOriginalUrl = metadataPayload.originalUrl as string | undefined;
    const finalSourceUrl = metadataPayload.sourceUrl as string | undefined;
    const finalDisplayName =
      (metadataPayload.displayName as string | undefined) ?? fetchedImageResult.result.filename;
    const finalAltTag = metadataPayload.altTag as string | undefined;
    const finalVariationSort =
      typeof metadataPayload.variationSort === 'number' ? metadataPayload.variationSort : undefined;

    const cachedImage = transformApiImageToCached({
      id: fetchedImageResult.result.id,
      filename: fetchedImageResult.result.filename,
      uploaded: fetchedImageResult.result.uploaded,
      variants: fetchedImageResult.result.variants,
      meta: metadataPayload
    });
    
    console.log(`[Update] Upserting cache for ${imageId} with tags:`, cachedImage.tags);
    upsertCachedImage(cachedImage);

    return NextResponse.json({
      success: true,
      folder: finalFolder,
      tags: finalTags,
      description: finalDescription,
      originalUrl: finalOriginalUrl,
      sourceUrl: finalSourceUrl,
      displayName: finalDisplayName,
      parentId: finalParentId,
      altTag: finalAltTag,
      variationSort: finalVariationSort,
    });

  } catch (error) {
    console.error('Update image error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
