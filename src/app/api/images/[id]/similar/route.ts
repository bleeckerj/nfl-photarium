/**
 * Similar Images API Route
 * 
 * GET /api/images/[id]/similar
 * Returns images visually similar to the specified image
 * 
 * Query params:
 *   - type: 'clip' | 'color' (default: 'clip')
 *   - limit: number (default: 10, max: 50)
 *   - includeStrangers: boolean - if true, also returns semantically distant images
 * 
 * Exclusion tags:
 *   - x-clip: Excludes image from CLIP/semantic search results
 *   - x-color: Excludes image from color search results
 *   - x-search: Excludes image from all vector searches
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCachedImage, getCachedImages } from '@/server/cloudflareImageCache';
import {
  searchByCLIP,
  searchByColor,
  searchCLIPStrangers,
  getImageVectors,
  isVectorSearchAvailable,
} from '@/server/vectorSearch';
import { shouldExcludeFromSearch } from '@/utils/searchExclusion';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  
  const searchType = searchParams.get('type') ?? 'clip';
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') ?? '10')));
  const strangersLimitParam = searchParams.get('strangersLimit');
  const strangersLimit = strangersLimitParam ? Math.min(50, Math.max(1, parseInt(strangersLimitParam))) : Math.ceil(limit / 2);
  const includeStrangers = searchParams.get('includeStrangers') === 'true';

  try {
    // Check if vector search is available
    const available = await isVectorSearchAvailable();
    if (!available) {
      return NextResponse.json(
        { error: 'Vector search not available. Ensure Redis Stack is running.' },
        { status: 503 }
      );
    }

    // Get the source image
    const sourceImage = await getCachedImage(id);
    if (!sourceImage) {
      return NextResponse.json(
        { error: 'Image not found' },
        { status: 404 }
      );
    }

    // Get vectors for this image
    const vectors = await getImageVectors(id);
    if (!vectors) {
      return NextResponse.json(
        { 
          error: 'No embeddings found for this image. Run batch embedding first.',
          imageId: id,
          hasEmbeddings: false
        },
        { status: 404 }
      );
    }

    let results;
    let strangers: Awaited<ReturnType<typeof searchCLIPStrangers>> | undefined;
    
    if (searchType === 'color') {
      if (!vectors.colorHistogram) {
        return NextResponse.json(
          { error: 'No color histogram found for this image' },
          { status: 404 }
        );
      }
      results = await searchByColor(vectors.colorHistogram, limit + 1);
    } else {
      if (!vectors.clipEmbedding) {
        return NextResponse.json(
          { error: 'No CLIP embedding found for this image' },
          { status: 404 }
        );
      }
      results = await searchByCLIP(vectors.clipEmbedding, limit + 1);
      
      // Get strangers if requested (only for CLIP search)
      if (includeStrangers) {
        strangers = await searchCLIPStrangers(vectors.clipEmbedding, strangersLimit + 1);
        strangers = strangers.filter(r => r.imageId !== id).slice(0, strangersLimit);
      }
    }

    // Filter out the source image itself
    const filteredResults = results.filter(r => r.imageId !== id).slice(0, limit);
    
    // Get all images to check for exclusion tags
    const allImages = await getCachedImages();
    const imageTagsMap = new Map(allImages.map(img => [img.id, img.tags]));
    
    // Filter out images with exclusion tags
    const searchTypeNorm = searchType === 'color' ? 'color' : 'clip';
    const finalResults = filteredResults.filter(r => {
      const tags = imageTagsMap.get(r.imageId);
      return !shouldExcludeFromSearch(tags, searchTypeNorm);
    });
    
    // Filter strangers too
    const finalStrangers = strangers 
      ? strangers.filter(r => {
          const tags = imageTagsMap.get(r.imageId);
          return !shouldExcludeFromSearch(tags, 'clip'); // strangers are always CLIP-based
        })
      : [];

    return NextResponse.json({
      sourceId: id,
      searchType,
      results: finalResults,
      strangers: finalStrangers,
      count: finalResults.length,
      strangersCount: finalStrangers.length,
    });
  } catch (error) {
    console.error('[API] Error in similar search:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
