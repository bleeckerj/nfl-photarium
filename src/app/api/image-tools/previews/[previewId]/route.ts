import { NextResponse } from 'next/server';

import { getImageToolPreview } from '@/server/image-tools/previewStore';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ previewId: string }> }
) {
  const { previewId } = await params;
  const preview = getImageToolPreview(previewId);
  if (!preview) {
    return NextResponse.json({ error: 'Image tool preview not found' }, { status: 404 });
  }
  return NextResponse.json({ preview });
}
