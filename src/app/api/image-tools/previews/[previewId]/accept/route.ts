import { NextResponse } from 'next/server';

import { acceptImageToolPreviewArtifact } from '@/server/image-tools/previewAcceptance';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ previewId: string }> }
) {
  try {
    const { previewId } = await params;
    const result = await acceptImageToolPreviewArtifact(previewId);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to accept image tool preview';
    const status = message.includes('not found') || message.includes('expired') ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
