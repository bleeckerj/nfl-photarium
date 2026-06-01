import Image from 'next/image';

import {
  formatFrameTime,
  type ActiveFramePreview,
  type FrameMeta,
  type VideoRecord,
} from '@/components/video-detail/videoTransforms';

interface FrameExtractionSectionProps {
  videoStatus: VideoRecord['videoStatus'];
  frameMeta: FrameMeta | null;
  frameMetaLoading: boolean;
  frameMetaError: string | null;
  frameSelectorInput: string;
  frameJumpInput: string;
  framePreviewLoading: boolean;
  extractingFrames: boolean;
  activeFramePreview: ActiveFramePreview | null;
  framePreviewError: string | null;
  onFrameSelectorInputChange: (value: string) => void;
  onFrameJumpInputChange: (value: string) => void;
  onJumpToFrame: () => void;
  onExtractFrames: () => void;
  onLoadExactFramePreview: (frameNumber: number) => void;
}

export default function FrameExtractionSection({
  videoStatus,
  frameMeta,
  frameMetaLoading,
  frameMetaError,
  frameSelectorInput,
  frameJumpInput,
  framePreviewLoading,
  extractingFrames,
  activeFramePreview,
  framePreviewError,
  onFrameSelectorInputChange,
  onFrameJumpInputChange,
  onJumpToFrame,
  onExtractFrames,
  onLoadExactFramePreview,
}: FrameExtractionSectionProps) {
  return (
    <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">Frame Extraction</h2>
        {frameMeta && (
          <p className="text-xs font-mono text-gray-600">
            frames={frameMeta.frameCount} fps={frameMeta.fps.toFixed(2)} exact={frameMeta.exactFrameCount ? 'yes' : 'estimated'}
          </p>
        )}
      </div>

      {videoStatus !== 'ready' ? (
        <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs font-mono text-amber-800">
          Video must be ready before frame extraction is available.
        </p>
      ) : frameMetaLoading ? (
        <p className="text-xs font-mono text-gray-600">Loading frame metadata...</p>
      ) : frameMetaError ? (
        <p className="rounded border border-red-200 bg-red-50 p-2 text-xs font-mono text-red-700">
          {frameMetaError}
        </p>
      ) : frameMeta ? (
        <>
          <p className="text-xs font-mono text-gray-600">
            Use symbolic selectors like <span className="font-semibold">first,middle,last</span> or exact frame numbers like <span className="font-semibold">1,100</span>.
            {typeof frameMeta.limits?.maxExtractFrameCount === 'number' && ` Max per request: ${frameMeta.limits.maxExtractFrameCount}.`}
          </p>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-3">
              <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_120px_auto]">
                <label className="flex flex-col gap-1 text-[11px] font-mono text-gray-700">
                  Selector
                  <input
                    type="text"
                    value={frameSelectorInput}
                    onChange={(event) => onFrameSelectorInputChange(event.target.value)}
                    className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-mono text-gray-800"
                    placeholder={frameMeta.defaultSelector || 'first,middle,last'}
                  />
                </label>
                <label className="flex flex-col gap-1 text-[11px] font-mono text-gray-700">
                  Jump To Frame
                  <input
                    type="text"
                    value={frameJumpInput}
                    onChange={(event) => onFrameJumpInputChange(event.target.value)}
                    className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-mono text-gray-800"
                    placeholder="1"
                  />
                </label>
                <div className="flex items-end gap-2">
                  <button
                    type="button"
                    onClick={onJumpToFrame}
                    disabled={framePreviewLoading}
                    className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-mono text-gray-700 hover:bg-gray-100 disabled:opacity-60"
                  >
                    {framePreviewLoading ? 'Loading...' : 'Load Frame'}
                  </button>
                  <button
                    type="button"
                    onClick={onExtractFrames}
                    disabled={extractingFrames}
                    className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-mono text-gray-700 hover:bg-gray-100 disabled:opacity-60"
                  >
                    {extractingFrames ? 'Downloading...' : 'Download Frames'}
                  </button>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {frameMeta.previews.map((preview) => (
                  <button
                    key={preview.frameNumber}
                    type="button"
                    onClick={() => onLoadExactFramePreview(preview.frameNumber)}
                    className={`overflow-hidden rounded border text-left ${
                      activeFramePreview?.frameNumber === preview.frameNumber
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 bg-gray-50 hover:border-gray-300'
                    }`}
                  >
                    <Image
                      src={preview.previewUrl}
                      alt={`Frame ${preview.frameNumber}`}
                      width={640}
                      height={360}
                      className="aspect-video w-full bg-black object-cover"
                      unoptimized
                    />
                    <div className="space-y-0.5 px-2 py-1.5 text-[11px] font-mono text-gray-700">
                      <p>frame={preview.frameNumber}</p>
                      <p>time={formatFrameTime(preview.timeSeconds)}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2 rounded border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs font-semibold text-gray-900">Exact Frame Preview</p>
              {activeFramePreview ? (
                <>
                  <Image
                    src={activeFramePreview.objectUrl}
                    alt={`Selected frame ${activeFramePreview.frameNumber}`}
                    width={1280}
                    height={720}
                    className="aspect-video w-full rounded bg-black object-contain"
                    unoptimized
                  />
                  <div className="space-y-1 text-[11px] font-mono text-gray-700">
                    <p>frame={activeFramePreview.frameNumber}</p>
                    <p>time={formatFrameTime(activeFramePreview.timeSeconds)}</p>
                  </div>
                </>
              ) : (
                <div className="flex aspect-video items-center justify-center rounded bg-white text-xs font-mono text-gray-500">
                  No frame selected
                </div>
              )}
              {framePreviewError && (
                <p className="rounded border border-red-200 bg-red-50 p-2 text-[11px] font-mono text-red-700">
                  {framePreviewError}
                </p>
              )}
            </div>
          </div>
        </>
      ) : (
        <p className="text-xs font-mono text-gray-600">Frame metadata unavailable.</p>
      )}
    </section>
  );
}
