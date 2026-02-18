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
import { getCachedImages, type CachedCloudflareImage } from '@/server/cloudflareImageCache';
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
  // Optional diagnostics from clients
  diagnostics?: {
    component?: string;
    trigger?: string;
  };
}

type SearchResultRow = {
  imageId?: string;
  id?: string;
  filename?: string;
  displayName?: string;
  score?: number;
  folder?: string;
  [key: string]: unknown;
};

type SearchResultNormalized = SearchResultRow & {
  imageId: string;
  id: string;
  canonicalImageId: string;
  requestedImageId?: string;
};

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

function _norm(value: string | undefined | null): string {
  return String(value ?? '').trim().toLowerCase();
}

function buildImageLookup(images: CachedCloudflareImage[]) {
  const byId = new Map<string, CachedCloudflareImage>();
  const byFilename = new Map<string, string[]>();
  const byDisplayName = new Map<string, string[]>();

  const pushIndex = (index: Map<string, string[]>, raw: string | undefined, id: string) => {
    const key = _norm(raw);
    if (!key) return;
    const list = index.get(key) ?? [];
    if (!list.includes(id)) list.push(id);
    index.set(key, list);
  };

  for (const image of images) {
    byId.set(image.id, image);
    pushIndex(byFilename, image.filename, image.id);
    pushIndex(byDisplayName, image.displayName, image.id);
  }

  return { byId, byFilename, byDisplayName };
}

function resolveCanonicalImageId(
  rawId: string | undefined,
  filename: string | undefined,
  displayName: string | undefined,
  lookup: ReturnType<typeof buildImageLookup>
): string | undefined {
  const { byId, byFilename, byDisplayName } = lookup;
  const tryResolve = (candidate: string | undefined): string | undefined => {
    const direct = String(candidate ?? '').trim();
    if (!direct) return undefined;
    if (byId.has(direct)) return direct;

    const key = _norm(candidate);
    if (!key) return undefined;

    const fromFilename = byFilename.get(key);
    if (fromFilename && fromFilename.length === 1) return fromFilename[0];

    const fromDisplayName = byDisplayName.get(key);
    if (fromDisplayName && fromDisplayName.length === 1) return fromDisplayName[0];

    return undefined;
  };

  return tryResolve(rawId) ?? tryResolve(filename) ?? tryResolve(displayName) ?? rawId;
}

function normalizeSearchResults(
  results: SearchResultRow[],
  allImages: CachedCloudflareImage[]
): SearchResultNormalized[] {
  const lookup = buildImageLookup(allImages);
  const normalized: SearchResultNormalized[] = [];

  for (const row of results) {
    const rawId = typeof row.imageId === 'string'
      ? row.imageId
      : typeof row.id === 'string'
        ? row.id
        : undefined;
    const filename = typeof row.filename === 'string' ? row.filename : undefined;
    const displayName = typeof row.displayName === 'string' ? row.displayName : undefined;
    const canonicalId = resolveCanonicalImageId(rawId, filename, displayName, lookup);
    if (!canonicalId) continue;

    const item: SearchResultNormalized = {
      ...row,
      imageId: canonicalId,
      id: canonicalId,
      canonicalImageId: canonicalId,
    };
    if (rawId && rawId !== canonicalId) {
      item.requestedImageId = rawId;
    }
    normalized.push(item);
  }

  return normalized;
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

    const requestId = request.headers.get('x-request-id') || crypto.randomUUID();
    const userAgent = request.headers.get('user-agent') ?? undefined;
    const referer = request.headers.get('referer') ?? undefined;
    const origin = request.headers.get('origin') ?? undefined;
    const forwardFor = request.headers.get('x-forwarded-for') ?? undefined;
    const realIp = request.headers.get('x-real-ip') ?? undefined;
    const ip = (forwardFor?.split(',')[0] || realIp || '').trim() || undefined;
    const diagnostics = body.diagnostics ?? {};
    const headerComponent = request.headers.get('x-photarium-component') ?? undefined;
    const headerTrigger = request.headers.get('x-photarium-trigger') ?? undefined;
    const headerSource = request.headers.get('x-photarium-source') ?? undefined;
    const component = diagnostics.component ?? headerComponent ?? 'TextSearch';
    const trigger = diagnostics.trigger ?? headerTrigger ?? 'unknown';

    console.log('[Search API] Received request:', {
      requestId,
      type,
      query,
      limit,
      bodyLimit: body.limit,
      namespace,
      diagnostics,
      component,
      trigger,
      source: headerSource,
      ip,
      userAgent,
      referer,
      origin,
    });

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
        results = await searchByText(query, internalLimit, {
          requestId,
          source: headerSource ?? 'api',
          route: 'POST /api/images/search',
          component,
          trigger,
          ip,
          userAgent,
          referer,
          origin,
          query,
        });
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

    const allImages = await getCachedImages();
    if (namespace !== null) {
      results = filterResultsByNamespace(results, allImages, namespace);
    }
    results = normalizeSearchResults(results as SearchResultRow[], allImages);

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

  const requestId = request.headers.get('x-request-id') || crypto.randomUUID();
  const userAgent = request.headers.get('user-agent') ?? undefined;
  const referer = request.headers.get('referer') ?? undefined;
  const origin = request.headers.get('origin') ?? undefined;
  const forwardFor = request.headers.get('x-forwarded-for') ?? undefined;
  const realIp = request.headers.get('x-real-ip') ?? undefined;
  const ip = (forwardFor?.split(',')[0] || realIp || '').trim() || undefined;
  const headerComponent = request.headers.get('x-photarium-component') ?? undefined;
  const headerTrigger = request.headers.get('x-photarium-trigger') ?? undefined;
  const headerSource = request.headers.get('x-photarium-source') ?? undefined;

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
      results = await searchByText(textQuery!, internalLimit, {
        requestId,
        source: headerSource ?? 'api',
        route: 'GET /api/images/search',
        component: headerComponent ?? 'Unknown',
        trigger: headerTrigger ?? 'query-string',
        ip,
        userAgent,
        referer,
        origin,
        query: textQuery!,
      });
    }

    const allImages = await getCachedImages();
    if (namespace !== null) {
      results = filterResultsByNamespace(results, allImages, namespace);
    }
    results = normalizeSearchResults(results as SearchResultRow[], allImages);

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
