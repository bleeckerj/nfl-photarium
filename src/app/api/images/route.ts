import { NextRequest, NextResponse } from 'next/server';
import { getCachedImages, getCacheStats } from '@/server/cloudflareImageCache';
import { batchGetColorMetadata, isVectorSearchAvailable } from '@/server/vectorSearch';

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
    
    // Merge embedding status from Redis if available
    let imagesWithEmbeddings = filtered;
    try {
      const redisAvailable = await isVectorSearchAvailable();
      if (redisAvailable && filtered.length > 0) {
        const imageIds = filtered.map(img => img.id);
        const colorMetadata = await batchGetColorMetadata(imageIds);
        
        imagesWithEmbeddings = filtered.map(img => {
          const meta = colorMetadata.get(img.id);
          if (meta) {
            return {
              ...img,
              hasClipEmbedding: meta.hasClipEmbedding,
              hasColorEmbedding: meta.hasColorEmbedding,
              dominantColors: meta.dominantColors ?? img.dominantColors,
              averageColor: meta.averageColor ?? img.averageColor,
            };
          }
          return img;
        });
      }
    } catch (redisError) {
      // Redis not available, continue without embedding status
      console.warn('[ImagesAPI] Redis unavailable for embedding status:', redisError);
    }
    
    const cache = getCacheStats();
    return NextResponse.json({ images: imagesWithEmbeddings, cache, namespace: namespace ?? null });
  } catch (error) {
    console.error('Fetch images error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
