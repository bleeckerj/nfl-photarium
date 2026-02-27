'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { RefreshCw, WandSparkles } from 'lucide-react';

type VideoRecord = {
  id: string;
  filename: string;
  uploaded: string;
  streamUid: string;
  playbackUrl?: string;
  hlsUrl?: string;
  thumbnailUrl?: string;
  previewUrl?: string;
  durationSeconds?: number;
  videoStatus: 'pending' | 'ready' | 'error';
  width?: number;
  height?: number;
  aspectRatio?: string;
  streamSyncedAt?: string;
  streamError?: string;
  hasClipEmbedding?: boolean;
  folder?: string;
  tags: string[];
  description?: string;
  originalUrl?: string;
  sourceUrl?: string;
  namespace?: string;
};

const formatDuration = (seconds?: number) => {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return '--';
  const rounded = Math.max(0, Math.round(seconds));
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export default function VideoDetailPage() {
  const params = useParams();
  const search = useSearchParams();
  const rawId = params?.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;

  const galleryPageParam = search.get('gpage');
  const galleryNamespaceParam = search.get('gns') ?? '';
  const backHref = useMemo(() => {
    if (!galleryPageParam) return '/';
    return `/?gpage=${encodeURIComponent(galleryPageParam)}&gns=${encodeURIComponent(galleryNamespaceParam)}`;
  }, [galleryNamespaceParam, galleryPageParam]);

  const [video, setVideo] = useState<VideoRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [embedding, setEmbedding] = useState(false);

  const fetchVideo = useCallback(async (forceRefresh = false) => {
    if (!id) return;
    setError(null);
    if (forceRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const response = await fetch(
        `/api/videos/${id}${forceRefresh ? '?refresh=1' : ''}`,
        { cache: 'no-store' }
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'Failed to load video');
      }
      setVideo(payload.video as VideoRecord);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load video');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => {
    void fetchVideo(false);
  }, [fetchVideo]);

  const queueEmbedding = useCallback(async () => {
    if (!id) return;
    setEmbedding(true);
    try {
      await fetch(`/api/videos/${id}`, { method: 'POST' });
      await fetchVideo(true);
    } finally {
      setEmbedding(false);
    }
  }, [fetchVideo, id]);

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 p-8">
        <div className="mx-auto max-w-5xl text-sm font-mono text-gray-600">Loading video...</div>
      </main>
    );
  }

  if (!video || error) {
    return (
      <main className="min-h-screen bg-gray-50 p-8">
        <div className="mx-auto max-w-5xl space-y-4">
          <Link href={backHref} className="text-sm font-mono text-blue-700 underline">Back to gallery</Link>
          <p className="text-sm font-mono text-red-700">{error || 'Video not found'}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center justify-between">
          <Link href={backHref} className="text-sm font-mono text-blue-700 underline">Back to gallery</Link>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void fetchVideo(true)}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-mono text-gray-700 hover:bg-gray-100 disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh Stream Status
            </button>
            <button
              type="button"
              onClick={() => void queueEmbedding()}
              disabled={embedding}
              className="inline-flex items-center gap-2 rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-mono text-gray-700 hover:bg-gray-100 disabled:opacity-60"
            >
              <WandSparkles className="h-3.5 w-3.5" />
              Queue CLIP Embedding
            </button>
          </div>
        </div>

        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h1 className="text-lg font-semibold text-gray-900">{video.filename}</h1>
          <p className="mt-1 text-xs font-mono text-gray-600">status={video.videoStatus} clip={video.hasClipEmbedding ? 'yes' : 'no'}</p>
          {video.streamError && (
            <p className="mt-1 text-xs font-mono text-amber-700">stream_error={video.streamError}</p>
          )}
        </section>

        <section className="rounded-lg border border-gray-200 bg-black p-3">
          {video.playbackUrl ? (
            <iframe
              src={video.playbackUrl}
              className="h-[60vh] w-full rounded"
              allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
              allowFullScreen
              title={video.filename}
            />
          ) : (
            <div className="flex h-[40vh] items-center justify-center text-sm font-mono text-gray-300">
              Playback URL unavailable
            </div>
          )}
        </section>

        <section className="grid gap-2 rounded-lg border border-gray-200 bg-white p-4 text-xs font-mono text-gray-700">
          <p>id={video.id}</p>
          <p>uploaded={new Date(video.uploaded).toISOString()}</p>
          <p>duration={formatDuration(video.durationSeconds)}</p>
          <p>dimensions={video.width && video.height ? `${video.width}x${video.height}` : '--'}</p>
          <p>aspect_ratio={video.aspectRatio || '--'}</p>
          <p>folder={video.folder || '[none]'}</p>
          <p>namespace={video.namespace || '[none]'}</p>
          <p>tags={(video.tags || []).join(', ') || '[none]'}</p>
          <p>hls={video.hlsUrl || '--'}</p>
          <p>thumb={video.thumbnailUrl || '--'}</p>
          <p>source={video.sourceUrl || '--'}</p>
          <p>original={video.originalUrl || '--'}</p>
        </section>
      </div>
    </main>
  );
}

