import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import sharp from 'sharp';
import { transformApiImageToCached, upsertCachedImage } from '@/server/cloudflareImageCache';
import { findDuplicatesByContentHash, findDuplicatesByOriginalUrl, toDuplicateSummary } from '@/server/duplicateDetector';
import { normalizeOriginalUrl } from '@/utils/urlNormalization';
import { enforceCloudflareMetadataLimit } from '@/utils/cloudflareMetadata';
import { extractExifSummary } from '@/utils/exif';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function withCors(response: NextResponse) {
  Object.entries(corsHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

export async function POST(request: NextRequest) {
  try {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;
    
    if (!accountId || !apiToken) {
      return withCors(NextResponse.json(
        { error: 'Cloudflare credentials not configured. Please set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN environment variables.' },
        { status: 500 }
      ));
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      logExternalIssue('No file provided');
      return withCors(NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      ));
    }

    if (!file.type.startsWith('image/')) {
      logExternalIssue('Rejected non-image upload', { filename: file.name, type: file.type });
      return withCors(NextResponse.json(
        { error: 'File must be an image' },
        { status: 400 }
      ));
    }

    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      logExternalIssue('Rejected oversized upload', { filename: file.name, bytes: file.size, limit: maxSize });
      return withCors(NextResponse.json(
        { error: 'File size must be less than 10MB' },
        { status: 400 }
      ));
    }

    const computeContentHash = (payload: Buffer) =>
      createHash('sha256').update(payload).digest('hex');

    const folder = formData.get('folder') as string;
    const tags = formData.get('tags') as string;
    const description = formData.get('description') as string;
    const originalUrl = formData.get('originalUrl') as string;
    const parentIdRaw = formData.get('parentId');

    const cleanFolder = folder && folder.trim() && folder !== 'undefined' ? folder.trim() : undefined;
    const cleanTags = tags && tags.trim() ? tags.trim().split(',').map(t => t.trim()).filter(Boolean) : [];
    const cleanDescription = description && description.trim() && description !== 'undefined' ? description.trim() : undefined;
    const cleanOriginalUrl = originalUrl && originalUrl.trim() && originalUrl !== 'undefined' ? originalUrl.trim() : undefined;
    const normalizedOriginalUrl = normalizeOriginalUrl(cleanOriginalUrl);
    const parentIdValue = typeof parentIdRaw === 'string' ? parentIdRaw.trim() : '';
    const cleanParentId = parentIdValue && parentIdValue !== 'undefined' ? parentIdValue : undefined;

    let duplicateMatches: Awaited<ReturnType<typeof findDuplicatesByOriginalUrl>> = [];
    if (normalizedOriginalUrl) {
      duplicateMatches = await findDuplicatesByOriginalUrl(normalizedOriginalUrl);
      if (duplicateMatches.length) {
        console.warn('[upload/external] Duplicate original URL detected', {
          originalUrl: cleanOriginalUrl,
          duplicateIds: duplicateMatches.map(match => match.id),
          folders: duplicateMatches.map(match => match.folder || null)
        });
        return withCors(NextResponse.json(
          {
            error: `Duplicate original URL "${cleanOriginalUrl}" detected`,
            duplicates: duplicateMatches.map(toDuplicateSummary)
          },
          { status: 409 }
        ));
      }
    }

    const bytes = await file.arrayBuffer();
    const originalBuffer = Buffer.from(bytes);
    const buffer = originalBuffer;
    const contentHash = computeContentHash(buffer);
    const exifSummary = await extractExifSummary(originalBuffer);

    if (!normalizedOriginalUrl) {
      duplicateMatches = await findDuplicatesByContentHash(contentHash);
      if (duplicateMatches.length) {
        console.warn('[upload/external] Duplicate content hash detected', {
          contentHash,
          duplicateIds: duplicateMatches.map(match => match.id),
          folders: duplicateMatches.map(match => match.folder || null)
        });
        return withCors(NextResponse.json(
          {
            error: 'Duplicate image content detected',
            duplicates: duplicateMatches.map(toDuplicateSummary)
          },
          { status: 409 }
        ));
      }
    }

    const uploadFormData = new FormData();
    uploadFormData.append('file', new Blob([buffer], { type: file.type }), file.name);

    const metadataPayload: Record<string, unknown> = {
      filename: file.name,
      displayName: file.name,
      uploadedAt: new Date().toISOString(),
      size: file.size,
      type: file.type,
      folder: cleanFolder,
      tags: cleanTags,
      description: cleanDescription,
      originalUrl: cleanOriginalUrl,
      originalUrlNormalized: normalizedOriginalUrl,
      contentHash,
      variationParentId: cleanParentId,
      exif: exifSummary,
    };

    const { metadata: limitedMetadata, dropped } = enforceCloudflareMetadataLimit(metadataPayload);
    if (dropped.length) {
      logExternalIssue('Metadata trimmed to fit Cloudflare limits', { dropped });
    }
    const metadata = JSON.stringify(limitedMetadata);

    uploadFormData.append('metadata', metadata);

    const cloudflareResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
        },
        body: uploadFormData,
      }
    );

    const result = await cloudflareResponse.json();

    if (!cloudflareResponse.ok) {
      console.error('Cloudflare API error:', result);
      return withCors(NextResponse.json(
        { error: result.errors?.[0]?.message || 'Failed to upload to Cloudflare' },
        { status: cloudflareResponse.status }
      ));
    }

    const imageData = result.result;
    const baseMeta = imageData.meta ?? limitedMetadata;
    upsertCachedImage(
      transformApiImageToCached({
        id: imageData.id,
        filename: imageData.filename,
        uploaded: imageData.uploaded,
        variants: imageData.variants,
        meta: baseMeta
      })
    );

    let webpVariantId: string | undefined;
    if (file.type === 'image/svg+xml') {
      try {
        const webpBuffer = await sharp(buffer).webp({ quality: 85 }).toBuffer();
        const webpName = file.name.replace(/\.svg$/i, '') + '.webp';
        const webpFormData = new FormData();
        webpFormData.append('file', new Blob([webpBuffer], { type: 'image/webp' }), webpName);
        const webpMetadata = {
          ...metadataPayload,
          filename: webpName,
          displayName: webpName,
          variationParentId: cleanParentId,
          linkedAssetId: imageData.id,
        };
        const { metadata: limitedWebpMetadata, dropped } = enforceCloudflareMetadataLimit(webpMetadata);
        if (dropped.length) {
          logExternalIssue('Metadata trimmed for webp variant', { dropped });
        }
        webpFormData.append('metadata', JSON.stringify(limitedWebpMetadata));
        const webpResponse = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiToken}`,
            },
            body: webpFormData,
          }
        );
        const webpJson = await webpResponse.json();
        if (!webpResponse.ok) {
          console.error('Cloudflare WebP upload error:', webpJson);
        } else {
          const webpResult = webpJson.result;
          webpVariantId = webpResult?.id;
          if (webpResult) {
            upsertCachedImage(
              transformApiImageToCached({
                id: webpResult.id,
                filename: webpResult.filename,
                uploaded: webpResult.uploaded,
                variants: webpResult.variants,
                meta: webpResult.meta ?? limitedWebpMetadata
              })
            );
          }
        }
      } catch (err) {
        console.error('Failed to convert SVG to WebP', err);
      }
    }

    if (webpVariantId) {
      const updatedMetadata = {
        ...metadataPayload,
        linkedAssetId: webpVariantId,
        updatedAt: new Date().toISOString(),
      };
      try {
        const patchResp = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1/${imageData.id}`,
          {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${apiToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ metadata: updatedMetadata }),
          }
        );
        if (!patchResp.ok) {
          const patchJson = await patchResp.json();
          console.error('Failed to patch SVG metadata', patchJson);
        } else {
          upsertCachedImage(
            transformApiImageToCached({
              id: imageData.id,
              filename: imageData.filename,
              uploaded: imageData.uploaded,
              variants: imageData.variants,
              meta: updatedMetadata
            })
          );
        }
      } catch (err) {
        console.error('Failed to patch SVG metadata', err);
      }
    }

    return withCors(NextResponse.json({
      id: imageData.id,
      filename: file.name,
      url: imageData.variants.find((v: string) => v.includes('public')) || imageData.variants[0],
      variants: imageData.variants,
      uploaded: new Date().toISOString(),
      folder: cleanFolder,
      tags: cleanTags,
      description: cleanDescription,
      originalUrl: cleanOriginalUrl,
      parentId: cleanParentId,
      linkedAssetId: webpVariantId,
      webpVariantId,
    }));

  } catch (error) {
    console.error('External upload error:', error);
    return withCors(NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    ));
  }
}
const logExternalIssue = (message: string, details?: Record<string, unknown>) => {
  console.warn('[upload/external] ' + message, details);
};
