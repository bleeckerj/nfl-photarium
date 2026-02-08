import { NextRequest, NextResponse } from 'next/server';

import { indexComfyWorkflowIntents } from '@/server/comfy/workflowIndexer';

type WorkflowIndexRequest = {
  imageIds?: string[];
  limit?: number;
};

function sanitizeImageIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const cleaned = value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
  return cleaned.length > 0 ? cleaned : undefined;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    let body: WorkflowIndexRequest = {};
    if (request.headers.get('content-type')?.includes('application/json')) {
      body = (await request.json()) as WorkflowIndexRequest;
    }

    const imageIds = sanitizeImageIds(body.imageIds);
    const limit = Number.isFinite(body.limit) ? Number(body.limit) : undefined;

    const result = await indexComfyWorkflowIntents({ imageIds, limit });
    return NextResponse.json(result);
  } catch (error) {
    console.error('[WorkflowIndexAPI] index error', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
