import { NextRequest, NextResponse } from 'next/server';
import { getVideoAssetRecord } from '@/server/videoCatalogStorage';
import {
  fetchVideoDownloadCandidate,
  probeVideoDownloadCandidates,
  resolveVideoDownloadCandidates,
} from '@/server/videoDownloadSourceService';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const withCors = (response: NextResponse) => {
  Object.entries(corsHeaders).forEach(([key, value]) => response.headers.set(key, value));
  return response;
};

const safeDownloadFilename = (input?: string) => {
  const base = (input || 'video').replace(/[^\w.\-]+/g, '_');
  return /\.(mp4|mov|webm|m4v)$/i.test(base) ? base : `${base}.mp4`;
};

const unavailableResponse = (status?: string) => {
  if (status === 'inprogress') {
    return NextResponse.json(
      { status: 'preparing', ready: false, error: 'Video download is being prepared. Retry in a few seconds.' },
      { status: 409 }
    );
  }
  return NextResponse.json(
    { status: 'unavailable', ready: false, error: 'No downloadable video URL is available for this asset.' },
    { status: 404 }
  );
};

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) return withCors(NextResponse.json({ error: 'Video ID is required' }, { status: 400 }));
    const video = await getVideoAssetRecord(id);
    if (!video) return withCors(NextResponse.json({ error: 'Video not found' }, { status: 404 }));

    const candidates = await resolveVideoDownloadCandidates(video);
    if (!candidates.urls.length) return withCors(unavailableResponse(candidates.streamDownloadStatus));

    if (request.nextUrl.searchParams.get('probe') === '1') {
      const probe = await probeVideoDownloadCandidates(candidates);
      if (!probe) return withCors(unavailableResponse(candidates.streamDownloadStatus));
      return withCors(NextResponse.json({
        status: 'ready',
        ready: true,
        downloadUrl: probe.url,
        source: candidates.streamUrls.has(probe.url) ? 'cloudflare-stream' : 'fallback',
      }));
    }

    const fetched = await fetchVideoDownloadCandidate(candidates);
    if (!fetched.response) {
      return withCors(NextResponse.json(
        { error: `Failed to fetch video from upstream (${fetched.lastStatus})` },
        { status: 502 }
      ));
    }
    const headers = new Headers();
    headers.set('Content-Type', fetched.response.headers.get('content-type') || 'video/mp4');
    headers.set('Content-Disposition', `attachment; filename="${safeDownloadFilename(video.filename)}"`);
    headers.set('X-Video-Download-Source', fetched.url);
    const length = fetched.response.headers.get('content-length');
    if (length) headers.set('Content-Length', length);
    return withCors(new NextResponse(fetched.response.body, { headers }));
  } catch (error) {
    console.error('[video-download] failed', error);
    return withCors(NextResponse.json({ error: 'Failed to download video' }, { status: 500 }));
  }
}
