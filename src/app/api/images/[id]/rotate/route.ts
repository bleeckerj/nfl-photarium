import { NextRequest, NextResponse } from 'next/server';
import sharp, { FormatEnum } from 'sharp';
import { parseCloudflareMetadata } from '@/utils/cloudflareMetadata';
import { transformApiImageToCached, upsertCachedImage } from '@/server/cloudflareImageCache';
import { fetchCloudflareImage, getCloudflareCredentials } from '@/server/cloudflareClient';

type SharpFormat = keyof FormatEnum;

const FORMAT_TO_MIME: Record<SharpFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  tiff: 'image/tiff'
} as Record<SharpFormat, string>;

const EXTENSION_TO_FORMAT: Record<string, SharpFormat> = {
  jpg: 'jpeg',
  jpeg: 'jpeg',
  png: 'png',
  webp: 'webp',
  avif: 'avif',
  tif: 'tiff',
  tiff: 'tiff'
};

const selectVariantUrl = (variants: string[]) => {
  if (!variants.length) {
    return undefined;
  }
  return variants.find((variant) => variant.includes('/public')) ?? variants[0];
};

const getRotationDegrees = (body: unknown) => {
  if (typeof body !== 'object' || body === null) {
    return { auto: true, degrees: undefined };
  }
  const payload = body as Record<string, unknown>;
  if (payload.auto === true) {
    return { auto: true, degrees: undefined };
  }
  if (payload.direction === 'left') {
    return { auto: false, degrees: -90 };
  }
  if (payload.direction === 'right') {
    return { auto: false, degrees: 90 };
  }
  if (typeof payload.degrees === 'number') {
    return { auto: false, degrees: payload.degrees };
  }
  return { auto: true, degrees: undefined };
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: imageId } = await params;
    if (!imageId) {
      return NextResponse.json({ error: 'Image ID is required' }, { status: 400 });
    }

    let requestBody: unknown;
    try {
      requestBody = await request.json();
    } catch {
      requestBody = undefined;
    }
    const { auto, degrees } = getRotationDegrees(requestBody);

    const { accountId, apiToken } = getCloudflareCredentials();
    const image = await fetchCloudflareImage(imageId, { accountId, apiToken });
    const variantUrl = selectVariantUrl(image.variants);
    if (!variantUrl) {
      return NextResponse.json({ error: 'No available image variant to rotate' }, { status: 400 });
    }

    const variantResponse = await fetch(variantUrl);
    if (!variantResponse.ok) {
      return NextResponse.json(
        { error: 'Failed to download image variant for rotation' },
        { status: variantResponse.status }
      );
    }

    const variantBuffer = Buffer.from(await variantResponse.arrayBuffer());
    let transformer = sharp(variantBuffer);
    if (auto) {
      transformer = transformer.rotate();
    } else if (typeof degrees === 'number') {
      transformer = transformer.rotate(degrees);
    } else {
      transformer = transformer.rotate();
    }

    const info = await transformer.metadata();
    const extension = image.filename?.split('.').pop()?.toLowerCase();
    const fallbackFormat = extension ? EXTENSION_TO_FORMAT[extension] : undefined;
    const chosenFormat = info.format && (info.format in FORMAT_TO_MIME) ? info.format as SharpFormat : fallbackFormat;
    const safeFormat: SharpFormat = chosenFormat && (chosenFormat in FORMAT_TO_MIME) ? chosenFormat : 'jpeg';
    const rotatedBuffer = await transformer.toFormat(safeFormat, { quality: 85 }).toBuffer();
    const contentType = FORMAT_TO_MIME[safeFormat] ?? 'image/jpeg';

    const parsedMeta = parseCloudflareMetadata(image.meta);
    const rotatedMetadata = {
      ...parsedMeta,
      filename: image.filename,
      uploadedAt: new Date().toISOString(),
      size: rotatedBuffer.byteLength,
      type: contentType,
      rotatedFromId: image.id,
      rotatedAt: new Date().toISOString()
    };

    const uploadFormData = new FormData();
    // Convert Buffer to Uint8Array for Blob compatibility
    const bufferArray = new Uint8Array(rotatedBuffer);
    uploadFormData.append('file', new Blob([bufferArray], { type: contentType }), image.filename);
    uploadFormData.append('metadata', JSON.stringify(rotatedMetadata));

    const uploadResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`
        },
        body: uploadFormData
      }
    );

    const uploadResult = await uploadResponse.json();
    if (!uploadResponse.ok) {
      console.error('Cloudflare rotation upload error:', uploadResult);
      return NextResponse.json(
        { error: uploadResult.errors?.[0]?.message || 'Failed to upload rotated image' },
        { status: uploadResponse.status }
      );
    }

    const newImage = uploadResult.result;
    upsertCachedImage(
      transformApiImageToCached({
        id: newImage.id,
        filename: newImage.filename,
        uploaded: newImage.uploaded,
        variants: newImage.variants,
        meta: newImage.meta ?? rotatedMetadata
      })
    );

    const publicUrl = newImage.variants.find((variant: string) => variant.includes('/public')) ?? newImage.variants[0];

    return NextResponse.json({
      rotatedFromId: imageId,
      id: newImage.id,
      filename: newImage.filename,
      url: publicUrl,
      variants: newImage.variants,
      metadata: rotatedMetadata,
      message: 'Image rotated and re-uploaded; update any existing references to the new URL.'
    });
  } catch (error) {
    console.error('Rotate image error:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    );
  }
}
