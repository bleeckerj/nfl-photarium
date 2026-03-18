import { spawn } from 'child_process';
import JSZip from 'jszip';
import { sanitizeFilename } from '@/utils/filename';

const DEFAULT_PREVIEW_FRAME_COUNT = Math.max(
  3,
  Number(process.env.VIDEO_FRAME_PREVIEW_COUNT ?? 7)
);

const MAX_PREVIEW_FRAME_COUNT = Math.max(
  DEFAULT_PREVIEW_FRAME_COUNT,
  Number(process.env.VIDEO_FRAME_PREVIEW_MAX_COUNT ?? 12)
);

const MAX_EXTRACT_FRAME_COUNT = Math.max(
  1,
  Number(process.env.VIDEO_FRAME_EXTRACT_MAX_COUNT ?? 24)
);

const DEFAULT_TIMEOUT_MS = Math.max(
  1_000,
  Number(process.env.VIDEO_FRAME_TIMEOUT_MS ?? 45_000)
);

type FfprobeStream = {
  codec_type?: string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  nb_frames?: string;
  duration?: string;
};

type FfprobeFormat = {
  duration?: string;
};

type FfprobePayload = {
  streams?: FfprobeStream[];
  format?: FfprobeFormat;
};

export type VideoFrameProbeResult = {
  durationSeconds: number;
  fps: number;
  frameCount: number;
  exactFrameCount: boolean;
};

export type VideoFramePreview = {
  frameNumber: number;
  timeSeconds: number;
};

export type ParsedFrameSelector = {
  symbolic: Array<'first' | 'middle' | 'last'>;
  numeric: number[];
  invalid: string[];
};

export type ResolvedFrameSelector = {
  frames: number[];
  invalid: string[];
};

const appendBuffer = (chunks: Buffer[], chunk: string | Buffer) => {
  chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
};

const parsePositiveNumber = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
};

const parseRate = (value?: string) => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed === '0/0') return undefined;
  if (!trimmed.includes('/')) {
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }
  const [numeratorRaw, denominatorRaw] = trimmed.split('/');
  const numerator = Number(numeratorRaw);
  const denominator = Number(denominatorRaw);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return undefined;
  }
  const result = numerator / denominator;
  return Number.isFinite(result) && result > 0 ? result : undefined;
};

const formatToolError = (tool: 'ffmpeg' | 'ffprobe', error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOENT' || /not found/i.test(message)) {
    return `${tool} is not installed or not available on PATH.`;
  }
  return `${tool} failed: ${message}`;
};

const runBinary = async ({
  tool,
  args,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: {
  tool: 'ffmpeg' | 'ffprobe';
  args: string[];
  timeoutMs?: number;
}) => {
  return await new Promise<{ stdout: Buffer; stderr: Buffer }>((resolve, reject) => {
    const child = spawn(tool, args);
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${tool} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => appendBuffer(stdoutChunks, chunk));
    child.stderr.on('data', (chunk) => appendBuffer(stderrChunks, chunk));

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({
          stdout: Buffer.concat(stdoutChunks),
          stderr: Buffer.concat(stderrChunks),
        });
        return;
      }
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
      reject(new Error(stderr || `${tool} exited with code ${code}`));
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(formatToolError(tool, error)));
    });
  }).catch((error) => {
    if (error instanceof Error && /timed out/i.test(error.message)) {
      throw error;
    }
    throw new Error(formatToolError(tool, error));
  });
};

export const probeVideoSource = async (
  sourceUrl: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<VideoFrameProbeResult> => {
  const { stdout } = await runBinary({
    tool: 'ffprobe',
    timeoutMs,
    args: [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_streams',
      '-show_format',
      sourceUrl,
    ],
  });

  const payload = JSON.parse(stdout.toString('utf8')) as FfprobePayload;
  const stream = (payload.streams || []).find((entry) => entry.codec_type === 'video');
  if (!stream) {
    throw new Error('No video stream found in the source.');
  }

  const fps = parseRate(stream.avg_frame_rate) || parseRate(stream.r_frame_rate);
  const durationSeconds = parsePositiveNumber(stream.duration) || parsePositiveNumber(payload.format?.duration);
  const exactFrameCount = Boolean(parsePositiveNumber(stream.nb_frames));
  const rawFrameCount = parsePositiveNumber(stream.nb_frames)
    || (fps && durationSeconds ? Math.max(1, Math.round(fps * durationSeconds)) : undefined);

  if (!fps || !durationSeconds || !rawFrameCount) {
    throw new Error('Unable to determine video duration, FPS, or frame count.');
  }

  return {
    durationSeconds,
    fps,
    frameCount: Math.max(1, Math.round(rawFrameCount)),
    exactFrameCount,
  };
};

export const parseFrameSelector = (selector: string): ParsedFrameSelector => {
  const normalized = typeof selector === 'string' ? selector : '';
  const tokens = normalized
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  const symbolic = new Set<'first' | 'middle' | 'last'>();
  const numeric = new Set<number>();
  const invalid = new Set<string>();

  for (const token of tokens) {
    if (token === 'first' || token === 'middle' || token === 'last') {
      symbolic.add(token);
      continue;
    }
    if (/^\d+$/.test(token)) {
      numeric.add(Number(token));
      continue;
    }
    invalid.add(token);
  }

  return {
    symbolic: Array.from(symbolic),
    numeric: Array.from(numeric).sort((a, b) => a - b),
    invalid: Array.from(invalid),
  };
};

export const resolveFrameSelector = ({
  selector,
  frameCount,
}: {
  selector: string;
  frameCount: number;
}): ResolvedFrameSelector => {
  const parsed = parseFrameSelector(selector);
  const frames = new Set<number>();
  const invalid = new Set(parsed.invalid);

  for (const token of parsed.symbolic) {
    if (token === 'first') frames.add(1);
    if (token === 'middle') frames.add(Math.max(1, Math.ceil(frameCount / 2)));
    if (token === 'last') frames.add(frameCount);
  }

  for (const frame of parsed.numeric) {
    if (!Number.isInteger(frame) || frame < 1 || frame > frameCount) {
      invalid.add(String(frame));
      continue;
    }
    frames.add(frame);
  }

  return {
    frames: Array.from(frames).sort((a, b) => a - b),
    invalid: Array.from(invalid).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
  };
};

export const buildPreviewFrames = ({
  frameCount,
  fps,
  count = DEFAULT_PREVIEW_FRAME_COUNT,
}: {
  frameCount: number;
  fps: number;
  count?: number;
}): VideoFramePreview[] => {
  const targetCount = Math.max(1, Math.min(frameCount, Math.round(count), MAX_PREVIEW_FRAME_COUNT));
  const numbers = new Set<number>();

  if (targetCount === 1) {
    numbers.add(1);
  } else {
    for (let index = 0; index < targetCount; index += 1) {
      const ratio = index / (targetCount - 1);
      numbers.add(1 + Math.round((frameCount - 1) * ratio));
    }
  }

  return Array.from(numbers)
    .sort((a, b) => a - b)
    .map((frameNumber) => ({
      frameNumber,
      timeSeconds: frameNumberToTime(frameNumber, fps),
    }));
};

export const frameNumberToTime = (frameNumber: number, fps: number) =>
  Math.max(0, (Math.max(1, frameNumber) - 1) / fps);

export const buildExtractedFrameFilename = (videoFilename: string, frameNumber: number, extension = 'jpg') => {
  const base = sanitizeFilename(videoFilename || 'video').replace(/\.[^.]+$/, '') || 'video';
  return `${base}-frame-${String(frameNumber).padStart(6, '0')}.${extension}`;
};

export const extractFrameBuffer = async ({
  sourceUrl,
  frameNumber,
  format = 'jpeg',
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: {
  sourceUrl: string;
  frameNumber: number;
  format?: 'jpeg' | 'png';
  timeoutMs?: number;
}) => {
  const frameIndex = Math.max(0, Math.round(frameNumber) - 1);
  const codec = format === 'png' ? 'png' : 'mjpeg';
  const { stdout } = await runBinary({
    tool: 'ffmpeg',
    timeoutMs,
    args: [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      sourceUrl,
      '-an',
      '-sn',
      '-dn',
      '-vf',
      `select=eq(n\\,${frameIndex})`,
      '-frames:v',
      '1',
      '-f',
      'image2pipe',
      '-vcodec',
      codec,
      'pipe:1',
    ],
  });

  if (!stdout.byteLength) {
    throw new Error(`ffmpeg extracted zero bytes for frame ${frameNumber}.`);
  }

  return stdout;
};

export const buildFrameArchive = async ({
  videoFilename,
  frameBuffers,
}: {
  videoFilename: string;
  frameBuffers: Array<{ frameNumber: number; buffer: Buffer }>;
}) => {
  const zip = new JSZip();
  for (const entry of frameBuffers) {
    zip.file(buildExtractedFrameFilename(videoFilename, entry.frameNumber), entry.buffer);
  }
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
};

export const validateExtractFrameCount = (frameCount: number) => {
  if (frameCount > MAX_EXTRACT_FRAME_COUNT) {
    throw new Error(`Too many frames requested. Maximum per request is ${MAX_EXTRACT_FRAME_COUNT}.`);
  }
};

export const getVideoFrameLimits = () => ({
  previewCount: DEFAULT_PREVIEW_FRAME_COUNT,
  maxPreviewCount: MAX_PREVIEW_FRAME_COUNT,
  maxExtractFrameCount: MAX_EXTRACT_FRAME_COUNT,
  timeoutMs: DEFAULT_TIMEOUT_MS,
});
