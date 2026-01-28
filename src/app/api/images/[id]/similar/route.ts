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

function normalizeNamespace(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed || trimmed === '__none__') return '';
  if (trimmed === '__all__') return null;
  return trimmed;
}

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
  const namespace = normalizeNamespace(searchParams.get('namespace'));
  const internalLimit = namespace === null ? limit : Math.min(250, limit * 10);
  const internalStrangersLimit = namespace === null ? strangersLimit : Math.min(250, strangersLimit * 10);

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
      results = await searchByColor(vectors.colorHistogram, internalLimit + 1);
    } else {
      if (!vectors.clipEmbedding) {
        return NextResponse.json(
          { error: 'No CLIP embedding found for this image' },
          { status: 404 }
        );
      }
      results = await searchByCLIP(vectors.clipEmbedding, internalLimit + 1);
      
      // Get strangers if requested (only for CLIP search)
      if (includeStrangers) {
        strangers = await searchCLIPStrangers(vectors.clipEmbedding, internalStrangersLimit + 1);
        strangers = strangers.filter(r => r.imageId !== id);
      }
    }

    // Filter out the source image itself
    const filteredResults = results.filter(r => r.imageId !== id);
    
    // Get all images to check for exclusion tags
    const allImages = await getCachedImages();
    const imageTagsMap = new Map(allImages.map(img => [img.id, img.tags]));
    const imageNamespaceMap = new Map(allImages.map(img => [img.id, img.namespace || '']));
    
    // Filter out images with exclusion tags
    const searchTypeNorm = searchType === 'color' ? 'color' : 'clip';
    const finalResults = filteredResults.filter(r => {
      const tags = imageTagsMap.get(r.imageId);
      if (namespace !== null) {
        const ns = imageNamespaceMap.get(r.imageId);
        if (ns === undefined) return false;
        if (namespace === '') {
          if (ns) return false;
        } else if (ns !== namespace) {
          return false;
        }
      }
      return !shouldExcludeFromSearch(tags, searchTypeNorm);
    });
    
    // Filter strangers too
    const finalStrangers = strangers 
      ? strangers.filter(r => {
          const tags = imageTagsMap.get(r.imageId);
          if (namespace !== null) {
            const ns = imageNamespaceMap.get(r.imageId);
            if (ns === undefined) return false;
            if (namespace === '') {
              if (ns) return false;
            } else if (ns !== namespace) {
              return false;
            }
          }
          return !shouldExcludeFromSearch(tags, 'clip'); // strangers are always CLIP-based
        })
      : [];

    const finalResultsLimited = finalResults.slice(0, limit);
    const finalStrangersLimited = finalStrangers.slice(0, strangersLimit);

    return NextResponse.json({
      sourceId: id,
      searchType,
      namespace: namespace ?? null,
      results: finalResultsLimited,
      strangers: finalStrangersLimited,
      count: finalResultsLimited.length,
      strangersCount: finalStrangersLimited.length,
    });
  } catch (error) {
    console.error('[API] Error in similar search:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
