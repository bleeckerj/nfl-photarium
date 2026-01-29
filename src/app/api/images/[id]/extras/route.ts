import { NextRequest, NextResponse } from 'next/server';
import { cleanString } from '@/utils/cloudflareMetadata';
import { getImageExtrasRecord, patchImageExtrasRecord } from '@/server/imageExtras';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: imageId } = await params;
    if (!imageId) {
      return NextResponse.json({ error: 'Image ID is required' }, { status: 400 });
    }

    const record = await getImageExtrasRecord(imageId);
    return NextResponse.json({ imageId, record });
  } catch (error) {
    console.error('[Extras] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: imageId } = await params;
    if (!imageId) {
      return NextResponse.json({ error: 'Image ID is required' }, { status: 400 });
    }

    let body: any = null;
    if (request.headers.get('content-type')?.includes('application/json')) {
      try {
        body = await request.json();
      } catch {
        body = null;
      }
    }

    const patch: { description?: string; altText?: string } = {};

    if (Object.prototype.hasOwnProperty.call(body ?? {}, 'description')) {
      const raw = body?.description;
      if (raw === null || raw === '') {
        patch.description = undefined;
      } else if (typeof raw === 'string') {
        patch.description = cleanString(raw);
      }
    }

    if (Object.prototype.hasOwnProperty.call(body ?? {}, 'altText')) {
      const raw = body?.altText;
      if (raw === null || raw === '') {
        patch.altText = undefined;
      } else if (typeof raw === 'string') {
        patch.altText = cleanString(raw);
      }
    }

    const record = await patchImageExtrasRecord(imageId, patch);
    return NextResponse.json({ imageId, record });
  } catch (error) {
    console.error('[Extras] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
