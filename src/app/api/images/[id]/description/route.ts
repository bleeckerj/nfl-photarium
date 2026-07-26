import { NextRequest, NextResponse } from 'next/server';
import { generateAndPersistImageDescription, ImageDescriptionError } from '@/server/imageDescriptionService';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: imageId } = await params;
    if (!imageId) {
      return NextResponse.json({ error: 'Image ID is required' }, { status: 400 });
    }

    let existingDescriptionFromClient: string | undefined;
    if (request.headers.get('content-type')?.includes('application/json')) {
      try {
        const body = await request.json();
        if (typeof body?.existingDescription === 'string') {
          existingDescriptionFromClient = body.existingDescription;
        }
      } catch {
        // Ignore malformed JSON bodies. We'll just omit client context.
      }
    }

    const generated = await generateAndPersistImageDescription({
      imageId,
      existingDescription: existingDescriptionFromClient,
      overrideStoredDescription: existingDescriptionFromClient !== undefined,
    });

    return NextResponse.json({ ...generated, saved: true });
  } catch (error) {
    if (error instanceof ImageDescriptionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Description generation error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
