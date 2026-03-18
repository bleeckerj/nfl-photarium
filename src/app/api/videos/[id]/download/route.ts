import { NextRequest, NextResponse } from 'next/server';
import { getVideoAssetRecord } from '@/server/videoCatalogStorage';
import { resolveVideoDownloadUrls } from '@/server/videoDownloadUrl';
import { createStreamDownload, getStreamDownloads } from '@/server/cloudflareStreamClient';

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
  if (/\.(mp4|mov|webm|m4v)$/i.test(base)) return base;
  return `${base}.mp4`;
};

const isLikelyBinaryVideoResponse = (response: Response, sourceUrl: string) => {
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (contentType.startsWith('video/')) return true;
  if (
    contentType.includes('text/html') ||
    contentType.includes('application/json') ||
    contentType.includes('text/plain') ||
    contentType.includes('application/xml')
  ) {
    return false;
  }

  const contentDisposition = (response.headers.get('content-disposition') || '').toLowerCase();
  if (/\.(mp4|mov|webm|m4v)(?:$|["';\s])/i.test(contentDisposition)) return true;
  if (/\.(mp4|mov|webm|m4v)(\?|$)/i.test(sourceUrl)) return true;
  return contentType.includes('application/octet-stream');
};

const toUniqueUrls = (urls: string[]) =>
  urls.filter((value, index, array) => Boolean(value) && array.indexOf(value) === index);

const fetchCandidateHead = async (url: string) => {
  try {
    return await fetch(url, {
      method: 'HEAD',
      cache: 'no-store',
      headers: {
        Accept: 'video/*,application/octet-stream;q=0.9,*/*;q=0.1',
      },
    });
  } catch {
    return null;
  }
};

const fetchCandidateProbe = async (url: string) => {
  try {
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        Accept: 'video/*,application/octet-stream;q=0.9,*/*;q=0.1',
        Range: 'bytes=0-1023',
      },
    });
    try {
      await response.body?.cancel();
    } catch {
      // Ignore cancel failures.
    }
    return response;
  } catch {
    return null;
  }
};

const resolveVideoCandidateUrls = async (video: Awaited<ReturnType<typeof getVideoAssetRecord>>) => {
  if (!video) {
    return {
      downloadUrls: [] as string[],
      streamDownloadStatus: undefined as string | undefined,
      streamUrls: new Set<string>(),
    };
  }

  const streamUrls: string[] = [];
  let streamDownloadStatus: string | undefined;
  if (video.streamUid) {
    try {
      const downloads = await getStreamDownloads(video.streamUid);
      streamDownloadStatus = downloads?.default?.status;
      if (typeof downloads?.default?.url === 'string' && downloads.default.url.trim()) {
        streamUrls.push(downloads.default.url.trim());
      } else {
        const created = await createStreamDownload(video.streamUid);
        streamDownloadStatus = created?.status ?? streamDownloadStatus;
        if (typeof created?.url === 'string' && created.url.trim()) {
          streamUrls.push(created.url.trim());
        }
      }
    } catch (error) {
      console.warn('[video-download] stream downloads lookup failed', {
        id: video.id,
        streamUid: video.streamUid,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    downloadUrls: toUniqueUrls([
      ...streamUrls,
      ...resolveVideoDownloadUrls(video),
    ]),
    streamDownloadStatus,
    streamUrls: new Set(streamUrls),
  };
};

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const probeOnly = _request.nextUrl.searchParams.get('probe') === '1';
    if (!id) {
      return withCors(NextResponse.json({ error: 'Video ID is required' }, { status: 400 }));
    }

    const video = await getVideoAssetRecord(id);
    if (!video) {
      return withCors(NextResponse.json({ error: 'Video not found' }, { status: 404 }));
    }

    const { downloadUrls, streamDownloadStatus, streamUrls } = await resolveVideoCandidateUrls(video);
    if (!downloadUrls.length) {
      if (streamDownloadStatus === 'inprogress') {
        return withCors(
          NextResponse.json(
            { status: 'preparing', ready: false, error: 'Video download is being prepared. Retry in a few seconds.' },
            { status: 409 }
          )
        );
      }
      return withCors(
        NextResponse.json(
          { status: 'unavailable', ready: false, error: 'No downloadable video URL is available for this asset.' },
          { status: 404 }
        )
      );
    }

    if (probeOnly) {
      for (const downloadUrl of downloadUrls) {
        const headResponse = await fetchCandidateHead(downloadUrl);
        if (headResponse?.ok && isLikelyBinaryVideoResponse(headResponse, downloadUrl)) {
          return withCors(NextResponse.json({
            status: 'ready',
            ready: true,
            downloadUrl,
            source: streamUrls.has(downloadUrl) ? 'cloudflare-stream' : 'fallback',
          }));
        }

        if (!headResponse || headResponse.status === 405 || headResponse.status === 403 || headResponse.status === 400) {
          const probeResponse = await fetchCandidateProbe(downloadUrl);
          if (probeResponse?.ok && isLikelyBinaryVideoResponse(probeResponse, downloadUrl)) {
            return withCors(NextResponse.json({
              status: 'ready',
              ready: true,
              downloadUrl,
              source: streamUrls.has(downloadUrl) ? 'cloudflare-stream' : 'fallback',
            }));
          }
        }
      }

      if (streamDownloadStatus === 'inprogress') {
        return withCors(
          NextResponse.json(
            { status: 'preparing', ready: false, error: 'Video download is being prepared. Retry in a few seconds.' },
            { status: 409 }
          )
        );
      }
      return withCors(
        NextResponse.json(
          { status: 'unavailable', ready: false, error: 'No downloadable video URL is available for this asset.' },
          { status: 404 }
        )
      );
    }

    let upstream: Response | null = null;
    let upstreamSourceUrl = '';
    let lastStatus = 502;

    for (const downloadUrl of downloadUrls) {
      const candidate = await fetch(downloadUrl, {
        cache: 'no-store',
        headers: {
          Accept: 'video/*,application/octet-stream;q=0.9,*/*;q=0.1',
        },
      });
      if (candidate.ok && candidate.body && isLikelyBinaryVideoResponse(candidate, downloadUrl)) {
        upstream = candidate;
        upstreamSourceUrl = downloadUrl;
        break;
      }
      lastStatus = candidate.status || 502;
    }

    if (!upstream) {
      return withCors(
        NextResponse.json(
          { error: `Failed to fetch video from upstream (${lastStatus})` },
          { status: 502 }
        )
      );
    }

    const headers = new Headers();
    headers.set('Content-Type', upstream.headers.get('content-type') || 'video/mp4');
    headers.set('Content-Disposition', `attachment; filename="${safeDownloadFilename(video.filename)}"`);
    headers.set('X-Video-Download-Source', upstreamSourceUrl);
    const length = upstream.headers.get('content-length');
    if (length) {
      headers.set('Content-Length', length);
    }

    return withCors(new NextResponse(upstream.body, { headers }));
  } catch (error) {
    console.error('[video-download] failed', error);
    return withCors(
      NextResponse.json({ error: 'Failed to download video' }, { status: 500 })
    );
  }
}
