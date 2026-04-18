import { NextRequest, NextResponse } from 'next/server';
import { fetchCloudflareImage, getCloudflareCredentials } from '@/server/cloudflareClient';

const pickVariantUrl = (variants: string[], variant: string) => {
  if (!variants.length) return undefined;
  const normalized = variant.trim();
  return (
    variants.find((url) => url.includes(`/${normalized}`)) ||
    variants.find((url) => url.includes('/public')) ||
    variants[0]
  );
};

const extractVariantFromUrl = (url: string, imageId: string): string | undefined => {
  // Cloudflare Images delivery URLs look like:
  // https://imagedelivery.net/<account_hash>/<image_id>/<variant>
  const marker = `/${imageId}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return undefined;
  const start = idx + marker.length;
  const rest = url.slice(start);
  const nextSlash = rest.indexOf('/');
  const variant = (nextSlash === -1 ? rest : rest.slice(0, nextSlash)).trim();
  return variant || undefined;
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

    const variant = (request.nextUrl.searchParams.get('variant') || 'public').trim();
    const disposition = request.nextUrl.searchParams.get('disposition')?.trim().toLowerCase() === 'inline'
      ? 'inline'
      : 'attachment';
    const image = await fetchCloudflareImage(imageId);

    // "original" must return the uploaded bytes (including embedded metadata), not a derived delivery variant.
    if (variant.toLowerCase() === 'original') {
      const { accountId, apiToken } = getCloudflareCredentials();
      const blobResponse = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1/${imageId}/blob`,
        {
          headers: {
            Authorization: `Bearer ${apiToken}`,
          },
          cache: 'no-store',
        }
      );

      if (!blobResponse.ok || !blobResponse.body) {
        return NextResponse.json(
          { error: 'Failed to download original image blob from Cloudflare' },
          { status: blobResponse.status || 502 }
        );
      }

      const headers = new Headers();
      headers.set('Content-Type', blobResponse.headers.get('content-type') || 'application/octet-stream');
      headers.set(
        'Content-Disposition',
        `${disposition}; filename="${image.filename || `${imageId}.bin`}"`
      );
      headers.set('X-Photarium-Variant-Requested', variant);
      headers.set('X-Photarium-Variant-Served', 'original');

      return new NextResponse(blobResponse.body, { headers });
    }

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
      `${disposition}; filename="${image.filename || `${imageId}.bin`}"`
    );
    headers.set('X-Photarium-Variant-Requested', variant);
    headers.set('X-Photarium-Variant-Served', extractVariantFromUrl(url, imageId) || 'unknown');

    return new NextResponse(response.body, { headers });
  } catch (error) {
    console.error('[Download] Failed to download image:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
