import { NextRequest, NextResponse } from 'next/server';
import { prepareDirectCreativeBriefHandoff } from '@/server/image-tools/creativeBriefHandoff';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Request body must be an object' }, { status: 400 });
  }
  try {
    const result = await prepareDirectCreativeBriefHandoff(id, body as { prompt: string; sourceRelationship?: unknown; aspectRatio?: unknown; provider?: unknown });
    return NextResponse.json({ state: 'handoff', ...result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to prepare direct prompt handoff' }, { status: 400 });
  }
}
