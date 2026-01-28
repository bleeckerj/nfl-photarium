import { NextRequest, NextResponse } from 'next/server';
import {
  getCachedImage,
  removeCachedImage,
  transformApiImageToCached,
  upsertCachedImage
} from '@/server/cloudflareImageCache';
import { fetchCloudflareImage, getCloudflareCredentials } from '@/server/cloudflareClient';
import { deleteImageVectors, isVectorSearchAvailable } from '@/server/vectorSearch';

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

    const result = await response.json();

    if (!response.ok) {
      console.error('Cloudflare API error:', result);
      return NextResponse.json(
        { error: result.errors?.[0]?.message || 'Failed to delete image from Cloudflare' },
        { status: response.status }
      );
    }

    removeCachedImage(imageId);

    // Best-effort cleanup of vector metadata in Redis.
    try {
      const redisAvailable = await isVectorSearchAvailable();
      if (redisAvailable) {
        await deleteImageVectors(imageId);
      }
    } catch {
      // ignore
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
      return NextResponse.json({ image: cached });
    }

    const image = await fetchCloudflareImage(imageId);
    const cachedImage = transformApiImageToCached(image);
    upsertCachedImage(cachedImage);

    return NextResponse.json({ image: cachedImage });
  } catch (error) {
    console.error('Fetch single image error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
