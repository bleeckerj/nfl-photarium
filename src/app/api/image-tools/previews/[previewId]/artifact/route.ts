import { NextResponse } from 'next/server';

import { getImageToolPreviewArtifact } from '@/server/image-tools/previewStore';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ previewId: string }> }
) {
  const { previewId } = await params;
  const artifact = getImageToolPreviewArtifact(previewId);
  if (!artifact) {
    return NextResponse.json({ error: 'Image tool preview artifact not found' }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(artifact.buffer), {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Disposition': `inline; filename="${artifact.filename.replace(/"/g, '')}"`,
      'Content-Type': artifact.contentType,
    },
  });
}
