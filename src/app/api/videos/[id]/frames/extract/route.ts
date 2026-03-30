import { NextRequest, NextResponse } from 'next/server';
import { getVideoAssetRecordWithSync } from '@/server/videoCatalogStorage';
import {
  buildExtractedFrameFilename,
  buildFrameArchive,
  extractFrameBuffer,
  probeVideoSource,
  resolveFrameSelector,
  validateExtractFrameCount,
} from '@/server/videoFrameService';
import { buildVideoFrameErrorResponse } from '@/server/videoFrameRouteErrors';
import { resolveVideoDownloadUrl } from '@/server/videoDownloadUrl';

type ExtractBody = {
  selector?: string;
};

const parseBody = async (request: NextRequest): Promise<ExtractBody> => {
  try {
    const payload = await request.json();
    if (!payload || typeof payload !== 'object') return {};
    return payload as ExtractBody;
  } catch {
    return {};
  }
};

const zipNameFromVideo = (filename?: string) => {
  const base = (filename || 'video').replace(/\.[^.]+$/, '').replace(/[^\w.\-]+/g, '_') || 'video';
  return `${base}-frames.zip`;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Video ID is required' }, { status: 400 });
    }

    const body = await parseBody(request);
    const selector = typeof body.selector === 'string' ? body.selector.trim() : '';
    if (!selector) {
      return NextResponse.json({ error: 'Selector is required.' }, { status: 400 });
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
    const resolved = resolveFrameSelector({ selector, frameCount: probe.frameCount });
    if (resolved.invalid.length > 0) {
      return NextResponse.json(
        { error: `Invalid frame selector tokens: ${resolved.invalid.join(', ')}` },
        { status: 400 }
      );
    }
    if (resolved.frames.length === 0) {
      return NextResponse.json({ error: 'Selector did not resolve to any frames.' }, { status: 400 });
    }

    validateExtractFrameCount(resolved.frames.length);

    const extracted = [];
    for (const frameNumber of resolved.frames) {
      const buffer = await extractFrameBuffer({ sourceUrl, frameNumber, format: 'jpeg' });
      extracted.push({ frameNumber, buffer });
    }

    if (extracted.length === 1) {
      const [single] = extracted;
      return new NextResponse(new Uint8Array(single.buffer), {
        status: 200,
        headers: {
          'Content-Type': 'image/jpeg',
          'Content-Disposition': `attachment; filename="${buildExtractedFrameFilename(video.filename, single.frameNumber)}"`,
          'Cache-Control': 'no-store',
          'X-Video-Frame-Numbers': String(single.frameNumber),
        },
      });
    }

    const archive = await buildFrameArchive({
      videoFilename: video.filename,
      frameBuffers: extracted,
    });

    return new NextResponse(new Uint8Array(archive), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${zipNameFromVideo(video.filename)}"`,
        'Cache-Control': 'no-store',
        'X-Video-Frame-Numbers': resolved.frames.join(','),
      },
    });
  } catch (error) {
    console.error('[video frames extract] failed', error);
    const response = buildVideoFrameErrorResponse(error, 'Failed to extract video frames');
    return NextResponse.json(response.body, { status: response.status });
  }
}
