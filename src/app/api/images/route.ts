import { NextRequest, NextResponse } from 'next/server';
import { getCachedImages, getCacheStats } from '@/server/cloudflareImageCache';

export async function GET(request: NextRequest) {
  try {
    const forceRefresh = request.nextUrl.searchParams.get('refresh') === '1';
    const namespaceParam = request.nextUrl.searchParams.get('namespace');
    const defaultNamespace = process.env.IMAGE_NAMESPACE || process.env.NEXT_PUBLIC_IMAGE_NAMESPACE || '';
    const namespace =
      namespaceParam === '__none__'
        ? ''
        : namespaceParam === '__all__'
          ? null
          : namespaceParam !== null
            ? namespaceParam.trim()
            : defaultNamespace;
    const images = await getCachedImages(forceRefresh);
    const filtered = namespace === null
      ? images
      : namespace === ''
        ? images.filter((image) => !image.namespace)
        : images.filter((image) => image.namespace === namespace);
    const cache = getCacheStats();
    return NextResponse.json({ images: filtered, cache, namespace: namespace ?? null });
  } catch (error) {
    console.error('Fetch images error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
