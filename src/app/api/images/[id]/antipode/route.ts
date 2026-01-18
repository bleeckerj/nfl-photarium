/**
 * Antipode Search API Route
 * 
 * GET /api/images/[id]/antipode
 * Returns images that are semantic or color opposites of the specified image
 * 
 * Query params:
 *   - domain: 'clip' | 'color' (default: 'clip')
 *   - method: varies by domain
 *     CLIP: 'negate' | 'stranger' | 'otherwise' | 'reflectroid'
 *     Color: 'complementary' | 'histogram' | 'lightness' | 'negative'
 *   - limit: number (default: 8, max: 20)
 * 
 * Exclusion tags:
 *   - x-clip: Excludes image from CLIP/semantic search results
 *   - x-color: Excludes image from color search results
 *   - x-search: Excludes image from all vector searches
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCachedImage, getCachedImages } from '@/server/cloudflareImageCache';
import {
  getImageVectors,
  isVectorSearchAvailable,
  searchCLIPNegated,
  searchCLIPVeryStranger,
  searchCLIPCentroidReflection,
  searchByText,
  searchColorComplementary,
  searchColorHistogramInverted,
  searchColorLightnessInverted,
  searchColorNegativeSpace,
} from '@/server/vectorSearch';
import { shouldExcludeFromSearch } from '@/utils/searchExclusion';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  
  const domain = searchParams.get('domain') ?? 'clip';
  const method = searchParams.get('method') ?? (domain === 'clip' ? 'stranger' : 'complementary');
  const limit = Math.min(20, Math.max(1, parseInt(searchParams.get('limit') ?? '8')));

  try {
    const available = await isVectorSearchAvailable();
    if (!available) {
      return NextResponse.json(
        { error: 'Vector search not available' },
        { status: 503 }
      );
    }

    const sourceImage = await getCachedImage(id);
    if (!sourceImage) {
      return NextResponse.json(
        { error: 'Image not found' },
        { status: 404 }
      );
    }

    const vectors = await getImageVectors(id);
    if (!vectors) {
      return NextResponse.json(
        { error: 'No embeddings found for this image' },
        { status: 404 }
      );
    }

    let results;
    let methodLabel: string;
    let description: string;

    if (domain === 'clip') {
      if (!vectors.clipEmbedding) {
        return NextResponse.json(
          { error: 'No CLIP embedding found for this image' },
          { status: 404 }
        );
      }

      switch (method) {
        case 'negate':
          methodLabel = 'Negate the Vector';
          description = 'Mathematical opposite: all embedding dimensions flipped';
          results = await searchCLIPNegated(vectors.clipEmbedding, limit, id);
          break;

        case 'stranger':
          methodLabel = 'Very Stranger';
          description = 'Most distant images in your collection';
          results = await searchCLIPVeryStranger(vectors.clipEmbedding, limit, id);
          break;

        case 'otherwise':
          methodLabel = 'Otherwise';
          description = 'Conceptual inversion: searching for opposite qualities';
          // Build inverted concept query - generic conceptual opposite
          const invertedQuery = 'artificial, chaotic, vast, futuristic, hard, bright, dynamic, playful, complex, cold';
          results = await searchByText(invertedQuery, limit + 1);
          results = results.filter(r => r.imageId !== id).slice(0, limit);
          break;

        case 'reflectroid':
          methodLabel = 'Quantoidal Reflectroid';
          description = 'Reflected through the collection centroid';
          results = await searchCLIPCentroidReflection(vectors.clipEmbedding, limit, id);
          break;

        default:
          return NextResponse.json(
            { error: `Invalid CLIP method: ${method}. Use: negate, stranger, otherwise, reflectroid` },
            { status: 400 }
          );
      }
    } else if (domain === 'color') {
      const avgColor = vectors.averageColor;
      const histogram = vectors.colorHistogram;

      if (!avgColor && !histogram) {
        return NextResponse.json(
          { error: 'No color data found for this image' },
          { status: 404 }
        );
      }

      switch (method) {
        case 'complementary':
          if (!avgColor) {
            return NextResponse.json({ error: 'No average color for complementary search' }, { status: 404 });
          }
          methodLabel = 'Complementary';
          description = `180° hue rotation from ${avgColor}`;
          results = await searchColorComplementary(avgColor, limit, id);
          break;

        case 'histogram':
          if (!histogram) {
            return NextResponse.json({ error: 'No color histogram for inversion' }, { status: 404 });
          }
          methodLabel = 'Histogram Inversion';
          description = 'Colors the original lacks, emphasized';
          results = await searchColorHistogramInverted(histogram, limit, id);
          break;

        case 'lightness':
          if (!avgColor) {
            return NextResponse.json({ error: 'No average color for lightness inversion' }, { status: 404 });
          }
          methodLabel = 'Lightness Inversion';
          description = 'Inverted lightness and saturation';
          results = await searchColorLightnessInverted(avgColor, limit, id);
          break;

        case 'negative':
          if (!histogram) {
            return NextResponse.json({ error: 'No color histogram for negative space' }, { status: 404 });
          }
          methodLabel = 'Negative Space';
          description = 'Mathematical opposite in color histogram space';
          results = await searchColorNegativeSpace(histogram, limit, id);
          break;

        default:
          return NextResponse.json(
            { error: `Invalid color method: ${method}. Use: complementary, histogram, lightness, negative` },
            { status: 400 }
          );
      }
    } else {
      return NextResponse.json(
        { error: `Invalid domain: ${domain}. Use: clip, color` },
        { status: 400 }
      );
    }

    // Get all images to check for exclusion tags
    const allImages = await getCachedImages();
    const imageTagsMap = new Map(allImages.map(img => [img.id, img.tags]));
    
    // Filter out images with exclusion tags
    const searchTypeNorm = domain === 'color' ? 'color' : 'clip';
    const filteredResults = results.filter(r => {
      const tags = imageTagsMap.get(r.imageId);
      const shouldExclude = shouldExcludeFromSearch(tags, searchTypeNorm);
      if (shouldExclude) {
        console.log(`[Antipode] Filtering out ${r.imageId} with tags: ${tags?.join(', ')} (searchType: ${searchTypeNorm})`);
      }
      return !shouldExclude;
    });
    
    console.log(`[Antipode] Filtered ${results.length - filteredResults.length} of ${results.length} results`);

    return NextResponse.json({
      sourceId: id,
      domain,
      method,
      methodLabel,
      description,
      results: filteredResults,
      count: filteredResults.length,
    });
  } catch (error) {
    console.error('[API] Error in antipode search:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
