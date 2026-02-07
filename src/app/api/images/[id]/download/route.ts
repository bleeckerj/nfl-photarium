import { NextRequest, NextResponse } from 'next/server';
import { fetchCloudflareImage } from '@/server/cloudflareClient';

const pickVariantUrl = (variants: string[], variant: string) => {
  if (!variants.length) return undefined;
  const normalized = variant.trim();
  return (
    variants.find((url) => url.includes(`/${normalized}`)) ||
    variants.find((url) => url.includes('/public')) ||
    variants[0]
  );
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: imageId } = await params;
    if (!imageId) {
      return NextResponse.json({ error: 'Image ID is required' }, { status: 400 });
    }

    const variant = request.nextUrl.searchParams.get('variant') || 'public';
    const image = await fetchCloudflareImage(imageId);
    const variants = Array.isArray(image.variants) ? image.variants : [];
    const url = pickVariantUrl(variants, variant);

    if (!url) {
      return NextResponse.json({ error: 'No available image variants' }, { status: 404 });
    }

    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok || !response.body) {
      return NextResponse.json(
        { error: 'Failed to download image from Cloudflare' },
        { status: response.status || 502 }
      );
    }

    const headers = new Headers();
    headers.set('Content-Type', response.headers.get('content-type') || 'application/octet-stream');
    headers.set(
      'Content-Disposition',
      `attachment; filename="${image.filename || `${imageId}.bin`}"`
    );

    return new NextResponse(response.body, { headers });
  } catch (error) {
    console.error('[Download] Failed to download image:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
