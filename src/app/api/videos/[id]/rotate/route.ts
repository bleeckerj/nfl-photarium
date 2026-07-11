import { NextRequest, NextResponse } from 'next/server';
import { normalizeQuarterTurn } from '@/server/imageRotationService';
import { rotateVideoAsset, VideoRotationError } from '@/server/videoRotationService';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: 'Video ID is required' }, { status: 400 });
    const body = await request.json().catch(() => undefined);
    const degrees = normalizeQuarterTurn(
      body && typeof body === 'object' ? (body as Record<string, unknown>).degrees : undefined
    );
    if (!degrees) {
      return NextResponse.json(
        { error: 'Rotation must be 90, 180, or 270 degrees' },
        { status: 400 }
      );
    }
    const video = await rotateVideoAsset(id, degrees);
    return NextResponse.json({
      video,
      message: 'Rotated video uploaded to Cloudflare Stream as a new asset.',
    });
  } catch (error) {
    console.error('[video-rotate] failed', error);
    const status = error instanceof VideoRotationError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to rotate video' },
      { status }
    );
  }
}
