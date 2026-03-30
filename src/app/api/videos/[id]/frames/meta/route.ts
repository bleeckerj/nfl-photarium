import { NextRequest, NextResponse } from 'next/server';
import { getVideoAssetRecordWithSync } from '@/server/videoCatalogStorage';
import {
  buildPreviewFrames,
  frameNumberToTime,
  getVideoFrameLimits,
  probeVideoSource,
} from '@/server/videoFrameService';
import { buildVideoFrameErrorResponse } from '@/server/videoFrameRouteErrors';
import { resolveVideoDownloadUrl } from '@/server/videoDownloadUrl';

const buildSourceUrl = (id: string, frameNumber: number) =>
  `/api/videos/${encodeURIComponent(id)}/frames/preview?frame=${encodeURIComponent(String(frameNumber))}`;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Video ID is required' }, { status: 400 });
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

    const previewCountParam = Number(request.nextUrl.searchParams.get('count') || '');
    const sourceUrl = video.hlsUrl || resolveVideoDownloadUrl(video);
    if (!sourceUrl) {
      return NextResponse.json(
        { error: 'Video does not have a source URL available for frame extraction.' },
        { status: 409 }
      );
    }

    const probe = await probeVideoSource(sourceUrl);
    const limits = getVideoFrameLimits();
    const previews = buildPreviewFrames({
      frameCount: probe.frameCount,
      fps: probe.fps,
      count: Number.isFinite(previewCountParam) && previewCountParam > 0 ? previewCountParam : limits.previewCount,
    }).map((preview) => ({
      ...preview,
      previewUrl: buildSourceUrl(id, preview.frameNumber),
    }));

    return NextResponse.json({
      videoId: video.id,
      filename: video.filename,
      durationSeconds: probe.durationSeconds,
      fps: probe.fps,
      frameCount: probe.frameCount,
      exactFrameCount: probe.exactFrameCount,
      midpointFrame: Math.max(1, Math.ceil(probe.frameCount / 2)),
      defaultSelector: 'first,middle,last',
      limits,
      previews,
      currentFrame: {
        frameNumber: 1,
        timeSeconds: frameNumberToTime(1, probe.fps),
        previewUrl: buildSourceUrl(id, 1),
      },
    });
  } catch (error) {
    console.error('[video frames meta] failed', error);
    const response = buildVideoFrameErrorResponse(error, 'Failed to load frame metadata');
    return NextResponse.json(response.body, { status: response.status });
  }
}
