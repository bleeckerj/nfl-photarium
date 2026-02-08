import { NextRequest, NextResponse } from 'next/server';

import { searchComfyWorkflowsByIntent } from '@/server/comfy/workflowSearch';
import { isWorkflowIntentSearchAvailable } from '@/server/comfy/workflowIntentSearch';

type WorkflowSearchRequest = {
  query?: string;
  limit?: number;
  offset?: number;
  includeWorkflowJson?: boolean;
};

function parseBody(body: WorkflowSearchRequest) {
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  const limit = Number.isFinite(body.limit) ? Number(body.limit) : undefined;
  const offset = Number.isFinite(body.offset) ? Number(body.offset) : undefined;

  return {
    query,
    limit,
    offset,
    includeWorkflowJson: body.includeWorkflowJson !== false,
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as WorkflowSearchRequest;
    const parsed = parseBody(body);

    if (!parsed.query) {
      return NextResponse.json({ error: 'Missing required field: query' }, { status: 400 });
    }

    const available = await isWorkflowIntentSearchAvailable();
    if (!available) {
      return NextResponse.json(
        {
          error:
            'Workflow intent search index is unavailable. Run POST /api/workflows/index to build embeddings.',
        },
        { status: 503 }
      );
    }

    const results = await searchComfyWorkflowsByIntent({
      query: parsed.query,
      limit: parsed.limit,
      offset: parsed.offset,
      includeWorkflowJson: parsed.includeWorkflowJson,
    });

    return NextResponse.json({
      query: parsed.query,
      count: results.length,
      results,
    });
  } catch (error) {
    console.error('[WorkflowSearchAPI] search error', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const query = request.nextUrl.searchParams.get('q') ?? request.nextUrl.searchParams.get('query');
  const limitRaw = request.nextUrl.searchParams.get('limit');
  const offsetRaw = request.nextUrl.searchParams.get('offset');
  const includeWorkflowJsonRaw = request.nextUrl.searchParams.get('includeWorkflowJson');

  return POST(
    new NextRequest(request.url, {
      method: 'POST',
      body: JSON.stringify({
        query,
        limit: limitRaw ? Number(limitRaw) : undefined,
        offset: offsetRaw ? Number(offsetRaw) : undefined,
        includeWorkflowJson:
          includeWorkflowJsonRaw === null ? true : includeWorkflowJsonRaw === '1' || includeWorkflowJsonRaw === 'true',
      }),
      headers: { 'content-type': 'application/json' },
    })
  );
}
