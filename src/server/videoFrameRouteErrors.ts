type VideoFrameErrorResponse = {
  status: number;
  body: {
    error: string;
    hints?: string[];
  };
};

const TOOLING_HINT =
  'Install FFmpeg (which also provides ffprobe) and ensure the binaries are available on PATH for the server process.';

const TIMEOUT_HINT =
  'The video probe/extraction timed out. Retry the request or increase VIDEO_FRAME_TIMEOUT_MS if the source is slow.';

export const buildVideoFrameErrorResponse = (
  error: unknown,
  fallback: string
): VideoFrameErrorResponse => {
  const message = error instanceof Error ? error.message : fallback;
  const lowered = message.toLowerCase();
  const hints: string[] = [];

  let status = 500;

  if (
    lowered.includes('ffprobe is not installed')
    || lowered.includes('ffmpeg is not installed')
    || lowered.includes('not available on path')
  ) {
    status = 503;
    hints.push(TOOLING_HINT);
  } else if (lowered.includes('timed out')) {
    status = 504;
    hints.push(TIMEOUT_HINT);
  }

  return {
    status,
    body: hints.length > 0 ? { error: message, hints } : { error: message },
  };
};
