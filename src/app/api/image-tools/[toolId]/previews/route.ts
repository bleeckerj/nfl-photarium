import { NextRequest, NextResponse } from 'next/server';

import { startImageToolPreviewRun } from '@/server/image-tools/executor';

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

    const preview = startImageToolPreviewRun(toolId, {
      imageId,
      request: typeof body?.request === 'object' && body.request !== null ? body.request : {},
    });
    if (!preview) {
      return NextResponse.json({ error: 'Failed to create image tool preview' }, { status: 500 });
    }

    return NextResponse.json({ preview }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create image tool preview';
    const status = message.includes('Unknown image tool') ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
