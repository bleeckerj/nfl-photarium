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

  // Artifacts are normally raster (WebP), but if one is ever an SVG it must not
  // render inline same-origin — force download and disable MIME sniffing.
  const isSvg =
    artifact.contentType.toLowerCase().includes('image/svg') ||
    artifact.filename.toLowerCase().endsWith('.svg');
  const headers: Record<string, string> = {
    'Cache-Control': 'no-store',
    'Content-Disposition': `${isSvg ? 'attachment' : 'inline'}; filename="${artifact.filename.replace(/"/g, '')}"`,
    'Content-Type': artifact.contentType,
  };
  if (isSvg) headers['X-Content-Type-Options'] = 'nosniff';

  return new NextResponse(new Uint8Array(artifact.buffer), { headers });
}
