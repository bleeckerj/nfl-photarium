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

  const requestId = request.headers.get('x-request-id') || crypto.randomUUID();
  const userAgent = request.headers.get('user-agent') ?? undefined;
  const referer = request.headers.get('referer') ?? undefined;
  const origin = request.headers.get('origin') ?? undefined;
  const forwardFor = request.headers.get('x-forwarded-for') ?? undefined;
  const realIp = request.headers.get('x-real-ip') ?? undefined;
  const ip = (forwardFor?.split(',')[0] || realIp || '').trim() || undefined;
  const component = request.headers.get('x-photarium-component') ?? 'AntipodeSearch';
  const trigger = request.headers.get('x-photarium-trigger') ?? 'unknown';
  const source = request.headers.get('x-photarium-source') ?? 'api';
  
  const domain = searchParams.get('domain') ?? 'clip';
  const method = searchParams.get('method') ?? (domain === 'clip' ? 'stranger' : 'complementary');
  const limit = Math.min(20, Math.max(1, parseInt(searchParams.get('limit') ?? '8')));
  const namespace = normalizeNamespace(searchParams.get('namespace'));
  const internalLimit = namespace === null ? limit : Math.min(250, limit * 10);

  console.log('[Antipode API] Received request:', {
    requestId,
    imageId: id,
    domain,
    method,
    limit,
    namespace,
    component,
    trigger,
    source,
    ip,
    userAgent,
    referer,
    origin,
  });

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
          results = await searchByText(invertedQuery, internalLimit + 1, {
            requestId,
            source,
            route: 'GET /api/images/[id]/antipode',
            component,
            trigger,
            ip,
            userAgent,
            referer,
            origin,
            query: invertedQuery,
          });
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
    const imageNamespaceMap = new Map(allImages.map(img => [img.id, img.namespace || '']));
    
    // Filter out images with exclusion tags
    const searchTypeNorm = domain === 'color' ? 'color' : 'clip';
    const filteredResults = results.filter(r => {
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
      namespace: namespace ?? null,
      results: filteredResults.slice(0, limit),
      count: Math.min(filteredResults.length, limit),
    });
  } catch (error) {
    console.error('[API] Error in antipode search:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
