import { NextRequest, NextResponse } from 'next/server';
import { generateAndPersistImageAlt, ImageAltError } from '@/server/imageAltService';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: imageId } = await params;
    if (!imageId) {
      return NextResponse.json({ error: 'Image ID is required' }, { status: 400 });
    }

    const generated = await generateAndPersistImageAlt(imageId);
    return NextResponse.json({
      ...generated,
      saved: true,
      // Retain legacy diagnostics; generation no longer writes Cloudflare metadata.
      droppedFields: [],
      metadataBytes: 0,
      metadataLimitBytes: 1024,
    });
  } catch (error) {
    if (error instanceof ImageAltError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('ALT tag generation error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
