import type { ImageToolRequest } from '@/server/image-tools/types';

const STILL_PREVIEW_FORMATS = new Set(['png', 'webp', 'jpg', 'jpeg']);
const ANIMATED_PREVIEW_FORMATS = new Set(['gif', 'webp']);
const STILL_PREVIEW_FALLBACK_FORMAT = 'png';
const ANIMATED_PREVIEW_FALLBACK_FORMAT = 'webp';
const ANIMATED_PREVIEW_DURATION_MS = 1200;
const ANIMATED_PREVIEW_FPS = 8;

const normalizeFormat = (format: string) => format.trim().toLowerCase();

const resolvePreviewFormat = (format: string) => {
  const requestedFormat = normalizeFormat(format);
  return STILL_PREVIEW_FORMATS.has(requestedFormat) ? requestedFormat : STILL_PREVIEW_FALLBACK_FORMAT;
};

const resolveAnimatedPreviewFormat = (format: string) => {
  const requestedFormat = normalizeFormat(format);
  return ANIMATED_PREVIEW_FORMATS.has(requestedFormat) ? requestedFormat : ANIMATED_PREVIEW_FALLBACK_FORMAT;
};

export const buildImageToolPreviewRequest = (request: ImageToolRequest): ImageToolRequest => {
  const animated = request.output.mode === 'animated';

  return {
    ...request,
    params: { ...request.params },
    output: {
      ...request.output,
      mode: animated ? 'animated' : 'still',
      format: animated ? resolveAnimatedPreviewFormat(request.output.format) : resolvePreviewFormat(request.output.format),
      preset: 'preview',
    },
    timeline: animated
      ? {
          ...request.timeline,
          durationMs: Math.min(request.timeline?.durationMs ?? ANIMATED_PREVIEW_DURATION_MS, ANIMATED_PREVIEW_DURATION_MS),
          fps: Math.min(request.timeline?.fps ?? ANIMATED_PREVIEW_FPS, ANIMATED_PREVIEW_FPS),
          loop: request.timeline?.loop ?? true,
        }
      : request.timeline ? { ...request.timeline } : undefined,
    renderContext: request.renderContext ? { ...request.renderContext } : undefined,
  };
};
