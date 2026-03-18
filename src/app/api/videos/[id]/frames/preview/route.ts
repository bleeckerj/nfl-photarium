import { NextRequest, NextResponse } from 'next/server';
import { getVideoAssetRecordWithSync } from '@/server/videoCatalogStorage';
import {
  extractFrameBuffer,
  frameNumberToTime,
  probeVideoSource,
} from '@/server/videoFrameService';
import { resolveVideoDownloadUrl } from '@/server/videoDownloadUrl';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Video ID is required' }, { status: 400 });
    }

    const frame = Number(request.nextUrl.searchParams.get('frame') || '');
    if (!Number.isInteger(frame) || frame < 1) {
      return NextResponse.json({ error: 'Frame must be a positive integer.' }, { status: 400 });
    }

    const video = await getVideoAssetRecordWithSync(id);
    if (!video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }
    if (video.videoStatus !== 'ready') {
      return NextResponse.json(
        { error: `Video is not ready for frame extraction (status: ${video.videoStatus}).` },
        { status: 409 }
      );
    }

    const sourceUrl = video.hlsUrl || resolveVideoDownloadUrl(video);
    if (!sourceUrl) {
      return NextResponse.json(
        { error: 'Video does not have a source URL available for frame extraction.' },
        { status: 409 }
      );
    }

    const probe = await probeVideoSource(sourceUrl);
    if (frame > probe.frameCount) {
      return NextResponse.json(
        { error: `Frame ${frame} is out of range. Max frame is ${probe.frameCount}.` },
        { status: 400 }
      );
    }

    const buffer = await extractFrameBuffer({ sourceUrl, frameNumber: frame, format: 'jpeg' });
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'no-store',
        'X-Video-Frame-Number': String(frame),
        'X-Video-Frame-Time': String(frameNumberToTime(frame, probe.fps)),
      },
    });
  } catch (error) {
    console.error('[video frames preview] failed', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to render frame preview' },
      { status: 500 }
    );
  }
}
