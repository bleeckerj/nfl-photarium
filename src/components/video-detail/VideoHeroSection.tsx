'use client';

import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import { Copy, ExternalLink } from 'lucide-react';

import { AssetTypeBadge } from '@/components/asset-detail/AssetTypeBadge';
import { ComfyIndicator } from '@/components/asset-detail/ComfyIndicator';
import { VideoRotationControls } from '@/components/video-detail/VideoRotationControls';
import type { RotatedVideoAsset } from '@/components/video-detail/useVideoRotation';
import {
  formatDuration,
  resolveVideoMediaPresentation,
  type VideoRecord,
} from '@/components/video-detail/videoTransforms';

type VideoHeroSectionProps = {
  video: VideoRecord;
  previewStyle: CSSProperties;
  rotation: {
    normalizedRotation: number;
    loading: boolean;
    error: string | null;
    rotatedAsset: RotatedVideoAsset | null;
    onAdjust: (delta: -90 | 90) => void;
    onConfirm: () => void;
  };
  onCopyId: () => void | Promise<void>;
};

const getStatusMessage = (video: VideoRecord) => {
  if (video.videoStatus === 'pending') return 'Video is still processing in Cloudflare Stream.';
  if (video.videoStatus === 'error') return 'Video processing failed.';
  return 'Playback URL unavailable.';
};

export function VideoHeroSection({ video, previewStyle, rotation, onCopyId }: VideoHeroSectionProps) {
  const presentation = resolveVideoMediaPresentation(video);
  const [hlsFailed, setHlsFailed] = useState(false);

  useEffect(() => {
    setHlsFailed(false);
  }, [video.id, presentation.mode, presentation.url]);

  const showHls = presentation.mode === 'hls' && !hlsFailed;
  const showPreview = presentation.mode === 'preview' || (presentation.mode === 'hls' && hlsFailed);
  const showUnavailable = presentation.mode === 'unavailable' || (presentation.mode === 'hls' && hlsFailed && !presentation.posterUrl);

  return (
    <section
      id="video-hero-section"
      aria-labelledby="video-hero-title"
      className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm"
    >
      <div className="grid gap-0 lg:grid-cols-[minmax(0,1.7fr)_minmax(18rem,0.8fr)]">
        <div className="bg-black p-3 sm:p-4">
          <div
            className="relative mx-auto w-full max-h-[70vh] overflow-hidden rounded bg-black"
            style={{ aspectRatio: presentation.aspectRatio }}
          >
            {presentation.mode === 'stream' && presentation.url ? (
              <iframe
                src={presentation.url}
                className="absolute inset-0 h-full w-full rounded"
                allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
                allowFullScreen
                title={video.displayName || video.filename}
                style={previewStyle}
              />
            ) : showHls && presentation.url ? (
              <video
                src={presentation.url}
                poster={presentation.posterUrl}
                controls
                playsInline
                preload="metadata"
                className="absolute inset-0 h-full w-full object-contain"
                onError={() => setHlsFailed(true)}
                style={previewStyle}
              />
            ) : showPreview && presentation.posterUrl ? (
              <Image
                src={presentation.posterUrl}
                alt={video.displayName || video.filename || 'Video preview'}
                fill
                sizes="(max-width: 1024px) 100vw, 65vw"
                className="object-contain"
                unoptimized
                priority
                style={previewStyle}
              />
            ) : showUnavailable ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center font-mono text-gray-300">
                <p className="text-sm">{getStatusMessage(video)}</p>
                <p className="text-xs text-gray-400">
                  status={video.videoStatus}
                  {video.streamError ? ` • ${video.streamError}` : ''}
                </p>
              </div>
            ) : null}

            {showPreview && !showUnavailable && (
              <div className="absolute inset-x-3 bottom-3 rounded border border-white/20 bg-black/75 px-3 py-2 text-xs font-mono text-white">
                {getStatusMessage(video)}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col justify-between gap-6 border-t border-gray-200 p-5 lg:border-l lg:border-t-0">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <AssetTypeBadge assetType="video" />
              <ComfyIndicator asset={video} id={`video-detail-comfy-indicator-${video.id}`} />
            </div>
            <div className="space-y-2">
              <h1 id="video-hero-title" className="break-words text-xl font-semibold leading-tight text-gray-900">
                {video.displayName || video.filename}
              </h1>
              <p className="break-all text-xs font-mono text-gray-500">{video.filename}</p>
            </div>

            <dl className="grid grid-cols-2 gap-3 border-y border-gray-200 py-4 text-xs font-mono">
              <div>
                <dt className="text-gray-500">Status</dt>
                <dd className="mt-1 text-gray-900">{video.videoStatus}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Duration</dt>
                <dd className="mt-1 text-gray-900">{formatDuration(video.durationSeconds)}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Dimensions</dt>
                <dd className="mt-1 text-gray-900">
                  {video.width && video.height ? `${video.width} × ${video.height}` : '--'}
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">Namespace</dt>
                <dd className="mt-1 break-all text-gray-900">{video.namespace || '[none]'}</dd>
              </div>
            </dl>

            {video.streamError && (
              <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs font-mono text-amber-800">
                stream_error={video.streamError}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void onCopyId()}
              className="inline-flex items-center gap-1.5 rounded border border-gray-300 px-2.5 py-1.5 text-xs text-gray-700 transition hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            >
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              Copy ID
            </button>
            {video.playbackUrl && (
              <a
                href={video.playbackUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded border border-gray-300 px-2.5 py-1.5 text-xs text-gray-700 transition hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                Open player
              </a>
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-gray-200 p-4">
        <VideoRotationControls
          normalizedRotation={rotation.normalizedRotation}
          loading={rotation.loading}
          error={rotation.error}
          rotatedAsset={rotation.rotatedAsset}
          onAdjust={rotation.onAdjust}
          onConfirm={rotation.onConfirm}
        />
      </div>
    </section>
  );
}
