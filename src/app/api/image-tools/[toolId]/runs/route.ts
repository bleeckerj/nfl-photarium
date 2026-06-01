import { NextRequest, NextResponse } from 'next/server';

import { startImageToolRun } from '@/server/image-tools/executor';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ toolId: string }> }
) {
  try {
    const { toolId } = await params;
    const body = await request.json().catch(() => ({}));
    const imageId = typeof body?.imageId === 'string' ? body.imageId.trim() : '';
    if (!imageId) {
      return NextResponse.json({ error: 'imageId is required' }, { status: 400 });
    }

    const run = startImageToolRun(toolId, {
      imageId,
      request: typeof body?.request === 'object' && body.request !== null ? body.request : {},
    });

    return NextResponse.json({ run }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to start image tool run';
    const status = message.includes('Unknown image tool') ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
