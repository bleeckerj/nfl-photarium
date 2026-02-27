import { NextRequest, NextResponse } from 'next/server';
import {
  type CachedCloudflareImage,
  getCachedImage,
  transformApiImageToCached,
  upsertCachedImage
} from '@/server/cloudflareImageCache';
import { fetchCloudflareImage, getCloudflareCredentials } from '@/server/cloudflareClient';
import { cleanupImageArtifacts } from '@/server/imageArtifactCleanup';
import { deleteStreamVideo } from '@/server/cloudflareStreamClient';
import {
  deleteVideoAssetRecord,
  getVideoAssetRecord,
} from '@/server/videoCatalogStorage';

const pickVariantUrl = (variants: string[] | undefined): string | undefined => {
  if (!Array.isArray(variants) || variants.length === 0) return undefined;
  return variants.find((url) => url.includes('/public')) || variants[0];
};

const parseSize = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return undefined;
};

const readKnownSize = (image: CachedCloudflareImage): number | undefined => {
  if (typeof image.size === 'number' && Number.isFinite(image.size) && image.size >= 0) {
    return image.size;
  }
  const meta = image as unknown as { meta?: Record<string, unknown> };
  const metadata = meta.meta;
  if (!metadata || typeof metadata !== 'object') return undefined;
  return (
    parseSize(metadata.size)
    || parseSize(metadata.bytes)
    || parseSize(metadata.fileSize)
  );
};

const parseContentRangeTotal = (value: string | null): number | undefined => {
  if (!value) return undefined;
  const match = value.match(/\/(\d+)$/);
  if (!match) return undefined;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const fetchSizeFromVariant = async (url: string): Promise<number | undefined> => {
  try {
    const head = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    const headerSize = parseSize(head.headers.get('content-length'));
    if (headerSize !== undefined) return headerSize;
  } catch {
    // Continue to range fallback.
  }

  try {
    const range = await fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      cache: 'no-store'
    });
    const fromLength = parseSize(range.headers.get('content-length'));
    const fromRange = parseContentRangeTotal(range.headers.get('content-range'));
    return fromRange ?? fromLength;
  } catch {
    return undefined;
  }
};

const enrichImageSize = async (image: CachedCloudflareImage): Promise<CachedCloudflareImage> => {
  const known = readKnownSize(image);
  if (known !== undefined) {
    return { ...image, size: known };
  }
  const variantUrl = pickVariantUrl(image.variants);
  if (!variantUrl) return image;
  const discoveredSize = await fetchSizeFromVariant(variantUrl);
  if (discoveredSize === undefined) return image;
  return { ...image, size: discoveredSize };
};

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: imageId } = await params;
   
    if (!imageId) {
      return NextResponse.json(
        { error: 'Image ID is required' },
        { status: 400 }
      );
    }

    const videoRecord = await getVideoAssetRecord(imageId);
    if (videoRecord) {
      try {
        await deleteStreamVideo(videoRecord.streamUid);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.toLowerCase().includes('not found') && !message.toLowerCase().includes('(404)')) {
          console.error('[VideoDelete] Stream API error:', error);
          return NextResponse.json(
            { error: 'Failed to delete video from Cloudflare Stream' },
            { status: 502 }
          );
        }
      }

      await deleteVideoAssetRecord(imageId);
      const cleanup = await cleanupImageArtifacts(imageId);
      if (!cleanup.success) {
        console.warn('[VideoDelete] Local artifact cleanup had failures', {
          imageId,
          steps: cleanup.steps,
        });
      }

      return NextResponse.json({ success: true, assetType: 'video' });
    }

    const { accountId, apiToken } = getCloudflareCredentials();

    // Delete image from Cloudflare
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1/${imageId}`,
      {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
        },
      }
    );

    const result = await response.json().catch(() => null);

    if (!response.ok && response.status !== 404) {
      console.error('Cloudflare API error:', result);
      return NextResponse.json(
        { error: result?.errors?.[0]?.message || 'Failed to delete image from Cloudflare' },
        { status: response.status }
      );
    }

    const cleanup = await cleanupImageArtifacts(imageId);
    if (!cleanup.success) {
      console.warn('[ImageDelete] Local artifact cleanup had failures', {
        imageId,
        steps: cleanup.steps,
      });
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Delete image error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: imageId } = await params;
    if (!imageId) {
      return NextResponse.json({ error: 'Image ID is required' }, { status: 400 });
    }

    const cached = await getCachedImage(imageId);
    if (cached) {
      const enriched = await enrichImageSize(cached);
      if ((cached.size ?? null) !== (enriched.size ?? null)) {
        upsertCachedImage(enriched);
      }
      return NextResponse.json({ image: { ...enriched, fileSizeBytes: enriched.size ?? null } });
    }

    const image = await fetchCloudflareImage(imageId);
    const transformed = transformApiImageToCached(image);
    const cachedImage = await enrichImageSize(transformed);
    upsertCachedImage(cachedImage);

    return NextResponse.json({ image: { ...cachedImage, fileSizeBytes: cachedImage.size ?? null } });
  } catch (error) {
    console.error('Fetch single image error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
