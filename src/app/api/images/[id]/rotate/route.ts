import { NextRequest, NextResponse } from 'next/server';
import {
  normalizeQuarterTurn,
  rotateCloudflareImage,
} from '@/server/imageRotationService';

const getRequestedDegrees = (body: unknown) => {
  if (!body || typeof body !== 'object') return null;
  const payload = body as Record<string, unknown>;
  if (payload.direction === 'left') return 270;
  if (payload.direction === 'right') return 90;
  return normalizeQuarterTurn(payload.degrees);
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Image ID is required' }, { status: 400 });
    }
    const body = await request.json().catch(() => undefined);
    const degrees = getRequestedDegrees(body);
    if (!degrees) {
      return NextResponse.json(
        { error: 'Rotation must be 90, 180, or 270 degrees' },
        { status: 400 }
      );
    }

    const result = await rotateCloudflareImage(id, degrees);
    const { buffer, ...responsePayload } = result;
    void buffer;
    return NextResponse.json({
      ...responsePayload,
      message: result.animated
        ? `Animated image rotated with ${result.frameCount} frames preserved.`
        : 'Image rotated and re-uploaded; update any existing references to the new URL.',
    });
  } catch (error) {
    console.error('[image-rotate] failed', error);
    const status = typeof (error as { status?: unknown }).status === 'number'
      ? (error as { status: number }).status
      : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to rotate image' },
      { status }
    );
  }
}
