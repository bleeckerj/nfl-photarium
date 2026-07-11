import { createStreamDownload, getStreamDownloads } from '@/server/cloudflareStreamClient';
import { resolveVideoDownloadUrls } from '@/server/videoDownloadUrl';
import type { VideoAssetRecord } from '@/server/videoCatalogStorage';

export type VideoDownloadCandidates = {
  urls: string[];
  streamDownloadStatus?: string;
  streamUrls: Set<string>;
};

const isIgnorableStreamDownloadsError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return /bad request/i.test(message);
};

export const isLikelyBinaryVideoResponse = (response: Response, sourceUrl: string) => {
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (contentType.startsWith('video/')) return true;
  if (
    contentType.includes('text/html')
    || contentType.includes('application/json')
    || contentType.includes('text/plain')
    || contentType.includes('application/xml')
  ) {
    return false;
  }
  const disposition = (response.headers.get('content-disposition') || '').toLowerCase();
  if (/\.(mp4|mov|webm|m4v)(?:$|["';\s])/i.test(disposition)) return true;
  if (/\.(mp4|mov|webm|m4v)(\?|$)/i.test(sourceUrl)) return true;
  return contentType.includes('application/octet-stream');
};

export async function resolveVideoDownloadCandidates(
  video: VideoAssetRecord
): Promise<VideoDownloadCandidates> {
  const streamUrls: string[] = [];
  let streamDownloadStatus: string | undefined;
  if (video.streamUid) {
    try {
      const downloads = await getStreamDownloads(video.streamUid);
      streamDownloadStatus = downloads?.default?.status;
      if (downloads?.default?.url?.trim()) {
        streamUrls.push(downloads.default.url.trim());
      } else {
        const created = await createStreamDownload(video.streamUid);
        streamDownloadStatus = created?.status ?? streamDownloadStatus;
        if (created?.url?.trim()) streamUrls.push(created.url.trim());
      }
    } catch (error) {
      const payload = {
        id: video.id,
        streamUid: video.streamUid,
        error: error instanceof Error ? error.message : String(error),
      };
      if (isIgnorableStreamDownloadsError(error)) {
        console.info('[video-download] Stream downloads unavailable; using fallback candidates', payload);
      } else {
        console.warn('[video-download] Stream downloads lookup failed', payload);
      }
    }
  }

  const urls = [...streamUrls, ...resolveVideoDownloadUrls(video)]
    .filter((value, index, array) => Boolean(value) && array.indexOf(value) === index);
  return { urls, streamDownloadStatus, streamUrls: new Set(streamUrls) };
}

export async function probeVideoDownloadCandidates(candidates: VideoDownloadCandidates) {
  for (const url of candidates.urls) {
    try {
      const head = await fetch(url, {
        method: 'HEAD',
        cache: 'no-store',
        headers: { Accept: 'video/*,application/octet-stream;q=0.9,*/*;q=0.1' },
      });
      if (head.ok && isLikelyBinaryVideoResponse(head, url)) return { url, response: head };
      if (head.status !== 405 && head.status !== 403 && head.status !== 400) continue;
    } catch {
      // Some download hosts reject HEAD; the range probe below is authoritative.
    }

    try {
      const response = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        headers: {
          Accept: 'video/*,application/octet-stream;q=0.9,*/*;q=0.1',
          Range: 'bytes=0-1023',
        },
      });
      const valid = response.ok && isLikelyBinaryVideoResponse(response, url);
      await response.body?.cancel().catch(() => undefined);
      if (valid) return { url, response };
    } catch {
      continue;
    }
  }
  return null;
}

export async function fetchVideoDownloadCandidate(candidates: VideoDownloadCandidates) {
  let lastStatus = 502;
  for (const url of candidates.urls) {
    const response = await fetch(url, {
      cache: 'no-store',
      headers: { Accept: 'video/*,application/octet-stream;q=0.9,*/*;q=0.1' },
    });
    if (response.ok && response.body && isLikelyBinaryVideoResponse(response, url)) {
      return { url, response };
    }
    lastStatus = response.status || 502;
  }
  return { url: '', response: null, lastStatus };
}
