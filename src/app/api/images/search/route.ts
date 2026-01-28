/**
 * Search Images API Route
 * 
 * POST /api/images/search
 * Search for similar images by various methods
 * 
 * Request body:
 *   - type: 'text' | 'image' | 'color' | 'upload'
 *   - query: string (for text search or hex color)
 *   - imageId: string (for image-based search)
 *   - limit: number (default: 48, max: 100)
 * 
 * Examples:
 *   POST { "type": "text", "query": "sunset on beach" }
 *   POST { "type": "color", "query": "#3B82F6" }
 *   POST { "type": "image", "imageId": "abc123" }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCachedImages } from '@/server/cloudflareImageCache';
import {
  searchByText,
  searchByHexColor,
  searchByCLIP,
  searchByColor,
  getImageVectors,
  isVectorSearchAvailable,
} from '@/server/vectorSearch';

interface SearchRequest {
  type: 'text' | 'image' | 'color';
  query?: string;
  imageId?: string;
  limit?: number;
  // Namespace filter. Use null/undefined to search across all namespaces.
  // Use '__none__' to search images with no namespace.
  namespace?: string | null;
}

function normalizeNamespace(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed || trimmed === '__none__') return '';
  if (trimmed === '__all__') return null;
  return trimmed;
}

function filterResultsByNamespace<T extends { imageId: string }>(
  results: T[],
  allImages: { id: string; namespace?: string }[],
  namespace: string | null
): T[] {
  if (namespace === null) return results;
  const idToNamespace = new Map(allImages.map((img) => [img.id, img.namespace || '']));
  return results.filter((r) => {
    const ns = idToNamespace.get(r.imageId);
    if (ns === undefined) return false;
    if (namespace === '') return !ns;
    return ns === namespace;
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Check if vector search is available
    const available = await isVectorSearchAvailable();
    if (!available) {
      return NextResponse.json(
        { error: 'Vector search not available. Ensure Redis Stack is running.' },
        { status: 503 }
      );
    }

    const body = await request.json() as SearchRequest;
    const { type, query, imageId } = body;
    const limit = Math.min(100, Math.max(1, body.limit ?? 48));
    const namespace = normalizeNamespace(body.namespace);
    const internalLimit = namespace === null ? limit : Math.min(250, limit * 10);
    
    console.log('[Search API] Received request:', { type, query, limit, bodyLimit: body.limit, namespace });

    if (!type) {
      return NextResponse.json(
        { error: 'Missing required field: type' },
        { status: 400 }
      );
    }

    let results;

    switch (type) {
      case 'text': {
        if (!query) {
          return NextResponse.json(
            { error: 'Missing required field: query (for text search)' },
            { status: 400 }
          );
        }
        results = await searchByText(query, internalLimit);
        break;
      }

      case 'color': {
        if (!query) {
          return NextResponse.json(
            { error: 'Missing required field: query (hex color like #3B82F6)' },
            { status: 400 }
          );
        }
        results = await searchByHexColor(query, internalLimit);
        break;
      }

      case 'image': {
        if (!imageId) {
          return NextResponse.json(
            { error: 'Missing required field: imageId (for image search)' },
            { status: 400 }
          );
        }
        
        const vectors = await getImageVectors(imageId);
        if (!vectors?.clipEmbedding) {
          return NextResponse.json(
            { error: 'No embeddings found for this image' },
            { status: 404 }
          );
        }
        
        results = await searchByCLIP(vectors.clipEmbedding, internalLimit + 1);
        // Filter out source image
        results = results.filter(r => r.imageId !== imageId);
        break;
      }

      default:
        return NextResponse.json(
          { error: `Invalid search type: ${type}. Use 'text', 'color', or 'image'` },
          { status: 400 }
        );
    }

    if (namespace !== null) {
      const allImages = await getCachedImages();
      results = filterResultsByNamespace(results, allImages, namespace);
    }

    results = results.slice(0, limit);

    return NextResponse.json({
      type,
      query: query ?? imageId,
      results,
      count: results.length,
    });
  } catch (error) {
    console.error('[API] Error in search:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET endpoint for simple queries
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  
  const textQuery = searchParams.get('q') ?? searchParams.get('text');
  const colorQuery = searchParams.get('color');
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') ?? '10')));
  const namespace = normalizeNamespace(searchParams.get('namespace'));
  const internalLimit = namespace === null ? limit : Math.min(250, limit * 10);

  if (!textQuery && !colorQuery) {
    return NextResponse.json({
      error: 'Missing query parameter. Use ?q=text or ?color=#hexcode',
      usage: {
        text: '/api/images/search?q=sunset%20on%20beach',
        color: '/api/images/search?color=%233B82F6',
      }
    }, { status: 400 });
  }

  try {
    const available = await isVectorSearchAvailable();
    if (!available) {
      return NextResponse.json(
        { error: 'Vector search not available. Ensure Redis Stack is running.' },
        { status: 503 }
      );
    }

    let results;
    let type: string;
    let query: string;

    if (colorQuery) {
      type = 'color';
      query = colorQuery;
      results = await searchByHexColor(colorQuery, internalLimit);
    } else {
      type = 'text';
      query = textQuery!;
      results = await searchByText(textQuery!, internalLimit);
    }

    if (namespace !== null) {
      const allImages = await getCachedImages();
      results = filterResultsByNamespace(results, allImages, namespace);
    }

    results = results.slice(0, limit);

    return NextResponse.json({
      type,
      query,
      results,
      count: results.length,
    });
  } catch (error) {
    console.error('[API] Error in search:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
