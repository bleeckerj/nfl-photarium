/**
 * Reference-Image Search API Route
 *
 * POST /api/images/search/upload (multipart/form-data)
 *   - file: the reference image (required, max 25MB)
 *   - limit: max similar results (default 48, max 100)
 *   - namespace: catalog namespace scope for similar results
 *
 * Returns { type: 'upload', exactMatches, results, count, coverage, warnings }.
 * The reference image is ephemeral — it is never added to the catalog.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  MAX_REFERENCE_BYTES,
  ReferenceDecodeError,
  searchByReferenceImage,
} from '@/server/imageSearchUpload';
import { normalizeNamespace } from '@/server/imageSearchRoute';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: 'Missing required field: file (multipart/form-data)' },
        { status: 400 }
      );
    }

    if (file.size > MAX_REFERENCE_BYTES) {
      return NextResponse.json(
        {
          error: `Reference image exceeds the maximum size of ${(MAX_REFERENCE_BYTES / 1024 / 1024).toFixed(0)}MB.`,
        },
        { status: 400 }
      );
    }

    const rawLimit = Number.parseInt(String(formData.get('limit') ?? ''), 10);
    const limit = Math.min(100, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 48));
    const namespace = normalizeNamespace(
      typeof formData.get('namespace') === 'string' ? (formData.get('namespace') as string) : null
    );

    const requestId = request.headers.get('x-request-id') || crypto.randomUUID();
    const userAgent = request.headers.get('user-agent') ?? undefined;
    const referer = request.headers.get('referer') ?? undefined;
    const origin = request.headers.get('origin') ?? undefined;
    const forwardFor = request.headers.get('x-forwarded-for') ?? undefined;
    const realIp = request.headers.get('x-real-ip') ?? undefined;
    const ip = (forwardFor?.split(',')[0] || realIp || '').trim() || undefined;
    const component = request.headers.get('x-photarium-component') ?? 'TextSearch';
    const trigger = request.headers.get('x-photarium-trigger') ?? 'unknown';
    const source = request.headers.get('x-photarium-source') ?? 'api';

    console.log('[Search API] Received upload search request:', {
      requestId,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
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

    const rawBytes = Buffer.from(await file.arrayBuffer());

    const outcome = await searchByReferenceImage(rawBytes, {
      fileName: file.name,
      fileType: file.type,
      limit,
      namespace,
      context: {
        requestId,
        source,
        route: 'POST /api/images/search/upload',
        component,
        trigger,
        ip,
        userAgent,
        referer,
        origin,
        query: file.name,
      },
    });

    if (
      outcome.warnings.includes('vector-search-unavailable') &&
      outcome.exactMatches.length === 0
    ) {
      return NextResponse.json(
        { error: 'Vector search not available. Ensure Redis Stack is running.' },
        { status: 503 }
      );
    }

    return NextResponse.json({
      type: 'upload',
      exactMatches: outcome.exactMatches,
      results: outcome.results,
      count: outcome.results.length,
      coverage: outcome.coverage,
      warnings: outcome.warnings,
    });
  } catch (error) {
    if (error instanceof ReferenceDecodeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('[API] Error in upload search:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
