import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { mkdir, readFile, readdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import sharp from 'sharp';

export const VIDEO_ANIMATED_WEBP_DEFAULT_MAX_WIDTH = Math.max(
  64,
  Number(process.env.VIDEO_ANIMATED_WEBP_MAX_WIDTH ?? 960)
);

export const VIDEO_ANIMATED_WEBP_DEFAULT_MAX_HEIGHT = Math.max(
  64,
  Number(process.env.VIDEO_ANIMATED_WEBP_MAX_HEIGHT ?? 960)
);

export const VIDEO_ANIMATED_WEBP_DEFAULT_MAX_BYTES = Math.max(
  256 * 1024,
  Number(process.env.VIDEO_ANIMATED_WEBP_MAX_BYTES ?? 10 * 1024 * 1024)
);

export const VIDEO_ANIMATED_WEBP_DEFAULT_FPS = Math.max(
  1,
  Math.min(30, Number(process.env.VIDEO_ANIMATED_WEBP_FPS ?? 12))
);

export const VIDEO_ANIMATED_WEBP_DEFAULT_TIMEOUT_MS = Math.max(
  1_000,
  Number(process.env.VIDEO_ANIMATED_WEBP_TIMEOUT_MS ?? 45_000)
);

const MAX_FFMPEG_STDERR_CHARS = 256 * 1024;
const DEFAULT_QUALITY_STEPS = [88, 82, 76, 70, 64, 58, 52];
const DEFAULT_SCALE_STEPS = [1, 0.92, 0.84, 0.76, 0.68, 0.6, 0.52, 0.44, 0.36, 0.3];
const FFMPEG_WEBP_ENCODER_CACHE_TTL_MS = 5 * 60 * 1000;
const WEBP_ENCODER_PREFERENCE = ['libwebp_anim', 'libwebp', 'webp'] as const;
const VIDEO_ANIMATED_WEBP_MAX_FRAMES = Math.max(
  12,
  Number(process.env.VIDEO_ANIMATED_WEBP_MAX_FRAMES ?? 240)
);

type WebpEncoderName = (typeof WEBP_ENCODER_PREFERENCE)[number];
export type VideoAnimatedWebpEncoder = WebpEncoderName | 'sharp-webp-fallback';

let ffmpegWebpEncoderCache:
  | {
      checkedAt: number;
      encoders: WebpEncoderName[];
    }
  | null = null;

const appendWithLimit = (
  current: string,
  chunk: string,
  limit: number
): { next: string; truncated: boolean } => {
  if (current.length >= limit) {
    return { next: current, truncated: true };
  }
  const remaining = limit - current.length;
  if (chunk.length <= remaining) {
    return { next: current + chunk, truncated: false };
  }
  return { next: current + chunk.slice(0, remaining), truncated: true };
};

const clampNumber = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Math.round(value)));

const mapFfmpegError = (message: string) => {
  if (/Unknown encoder ['"]?(libwebp|libwebp_anim|webp)['"]?/i.test(message)) {
    return [
      'FFmpeg does not have WebP encoder support enabled.',
      'This server will use Sharp fallback encoding, but ensure ffmpeg can still decode your input.',
    ].join(' ');
  }
  return message;
};

const parseWebpEncoders = (raw: string): WebpEncoderName[] => {
  const discovered = new Set<WebpEncoderName>();
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    for (const encoder of WEBP_ENCODER_PREFERENCE) {
      const pattern = new RegExp(`\\b${encoder}\\b`, 'i');
      if (pattern.test(line)) {
        discovered.add(encoder);
      }
    }
  }
  return WEBP_ENCODER_PREFERENCE.filter((encoder) => discovered.has(encoder));
};

const detectWebpEncoders = async (): Promise<WebpEncoderName[]> => {
  const now = Date.now();
  if (ffmpegWebpEncoderCache && now - ffmpegWebpEncoderCache.checkedAt < FFMPEG_WEBP_ENCODER_CACHE_TTL_MS) {
    return ffmpegWebpEncoderCache.encoders;
  }

  const encoders = await new Promise<WebpEncoderName[]>((resolve, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-encoders']);
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg -encoders failed (${code}): ${stderr || stdout}`));
        return;
      }
      resolve(parseWebpEncoders(`${stdout}\n${stderr}`));
    });
    child.on('error', reject);
  }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT' || /not found/i.test(message)) {
      throw new Error(
        'FFmpeg is not installed or not available on PATH. Install FFmpeg and retry animated WebP generation.'
      );
    }
    throw error;
  });

  ffmpegWebpEncoderCache = {
    checkedAt: now,
    encoders,
  };
  return encoders;
};

const toPositiveInt = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.round(parsed);
    }
  }
  return undefined;
};

const runFfmpeg = async ({ args, timeoutMs }: { args: string[]; timeoutMs: number }) => {
  await new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', args);
    let stderr = '';
    let stderrTruncated = false;
    const timer = setTimeout(() => {
      ffmpeg.kill('SIGKILL');
      reject(new Error(`ffmpeg timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    ffmpeg.stderr.on('data', (data) => {
      const appended = appendWithLimit(stderr, data.toString(), MAX_FFMPEG_STDERR_CHARS);
      stderr = appended.next;
      if (appended.truncated) {
        stderrTruncated = true;
      }
    });

    ffmpeg.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      const suffix = stderrTruncated ? ' [stderr truncated]' : '';
      reject(new Error(mapFfmpegError(`ffmpeg exited with code ${code}: ${stderr}${suffix}`)));
    });

    ffmpeg.on('error', (error) => {
      clearTimeout(timer);
      const message = error instanceof Error ? error.message : String(error);
      if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
        reject(new Error('FFmpeg is not installed or not available on PATH.'));
        return;
      }
      reject(new Error(mapFfmpegError(message)));
    });
  });
};

const buildScaleFilter = ({ fps, width, height }: { fps: number; width: number; height: number }) =>
  `fps=${fps},scale=min(${width}\\,iw):min(${height}\\,ih):force_original_aspect_ratio=decrease:flags=lanczos`;

const runFfmpegWebpEncode = async ({
  inputUrl,
  outputPath,
  fps,
  width,
  height,
  quality,
  encoder,
  loop,
  timeoutMs,
}: {
  inputUrl: string;
  outputPath: string;
  fps: number;
  width: number;
  height: number;
  quality: number;
  encoder: WebpEncoderName;
  loop: boolean;
  timeoutMs: number;
}) => {
  const ffmpegArgs = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    inputUrl,
    '-an',
    '-sn',
    '-dn',
    '-vf',
    buildScaleFilter({ fps, width, height }),
    '-loop',
    loop ? '0' : '1',
    '-c:v',
    encoder,
    '-quality',
    String(quality),
    '-compression_level',
    '6',
    '-preset',
    'picture',
    '-vsync',
    '0',
    outputPath,
  ];

  await runFfmpeg({ args: ffmpegArgs, timeoutMs });
};

const runFfmpegFrameExtract = async ({
  inputUrl,
  outputDir,
  fps,
  width,
  height,
  timeoutMs,
}: {
  inputUrl: string;
  outputDir: string;
  fps: number;
  width: number;
  height: number;
  timeoutMs: number;
}) => {
  const framePattern = join(outputDir, 'frame-%06d.png');
  const ffmpegArgs = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    inputUrl,
    '-an',
    '-sn',
    '-dn',
    '-vf',
    buildScaleFilter({ fps, width, height }),
    '-frames:v',
    String(VIDEO_ANIMATED_WEBP_MAX_FRAMES),
    '-vsync',
    '0',
    framePattern,
  ];

  await runFfmpeg({ args: ffmpegArgs, timeoutMs });
};

const encodeFramesWithSharp = async ({
  frameBuffers,
  fps,
  loop,
  quality,
}: {
  frameBuffers: Buffer[];
  fps: number;
  loop: boolean;
  quality: number;
}) => {
  if (!frameBuffers.length) {
    throw new Error('FFmpeg extracted zero frames from the source video.');
  }

  const metas = await Promise.all(frameBuffers.map((frame) => sharp(frame).metadata()));
  const widths = metas.map((meta) => meta.width || 0).filter(Boolean);
  const heights = metas.map((meta) => meta.height || 0).filter(Boolean);
  const maxWidth = Math.max(...widths, 1);
  const maxHeight = Math.max(...heights, 1);

  const preparedFrames = await Promise.all(
    frameBuffers.map(async (frame) =>
      sharp(frame)
        .resize(maxWidth, maxHeight, {
          fit: 'contain',
          background: { r: 255, g: 255, b: 255, alpha: 0 },
        })
        .ensureAlpha()
        .raw()
        .toBuffer()
    )
  );

  const stacked = Buffer.concat(preparedFrames);
  const delayMs = Math.max(1, Math.round(1000 / fps));

  const animatedBuffer = await sharp(stacked, {
    raw: {
      width: maxWidth,
      height: maxHeight * preparedFrames.length,
      channels: 4,
      pageHeight: maxHeight,
    },
  })
    .webp({
      quality,
      effort: 4,
      loop: loop ? 0 : 1,
      delay: Array(preparedFrames.length).fill(delayMs),
    })
    .toBuffer();

  return {
    buffer: animatedBuffer,
    width: maxWidth,
    height: maxHeight,
  };
};

const readPngFrames = async (outputDir: string): Promise<Buffer[]> => {
  const entries = await readdir(outputDir);
  const frameFiles = entries
    .filter((entry) => entry.toLowerCase().endsWith('.png'))
    .sort((a, b) => a.localeCompare(b));
  if (!frameFiles.length) {
    return [];
  }
  return Promise.all(frameFiles.map((file) => readFile(join(outputDir, file))));
};

export type VideoAnimatedWebpOptions = {
  maxWidth?: number;
  maxHeight?: number;
  maxOutputBytes?: number;
  fps?: number;
  timeoutMs?: number;
  loop?: boolean;
};

export type VideoAnimatedWebpResult = {
  buffer: Buffer;
  bytes: number;
  width?: number;
  height?: number;
  fps: number;
  loop: boolean;
  quality: number;
  scale: number;
  maxWidth: number;
  maxHeight: number;
  maxOutputBytes: number;
  timeoutMs: number;
  attempts: number;
  encoder: VideoAnimatedWebpEncoder;
};

const normalizeOptions = (input?: VideoAnimatedWebpOptions) => {
  const requestedMaxWidth = toPositiveInt(input?.maxWidth);
  const requestedMaxHeight = toPositiveInt(input?.maxHeight);
  const requestedMaxOutputBytes = toPositiveInt(input?.maxOutputBytes);
  const requestedFps = toPositiveInt(input?.fps);
  const requestedTimeoutMs = toPositiveInt(input?.timeoutMs);

  return {
    maxWidth: clampNumber(
      requestedMaxWidth ?? VIDEO_ANIMATED_WEBP_DEFAULT_MAX_WIDTH,
      64,
      4000
    ),
    maxHeight: clampNumber(
      requestedMaxHeight ?? VIDEO_ANIMATED_WEBP_DEFAULT_MAX_HEIGHT,
      64,
      4000
    ),
    maxOutputBytes: clampNumber(
      requestedMaxOutputBytes ?? VIDEO_ANIMATED_WEBP_DEFAULT_MAX_BYTES,
      64 * 1024,
      10 * 1024 * 1024
    ),
    fps: clampNumber(requestedFps ?? VIDEO_ANIMATED_WEBP_DEFAULT_FPS, 1, 30),
    timeoutMs: clampNumber(
      requestedTimeoutMs ?? VIDEO_ANIMATED_WEBP_DEFAULT_TIMEOUT_MS,
      1_000,
      120_000
    ),
    loop: input?.loop !== false,
  };
};

export async function convertVideoToAnimatedWebp(
  sourceUrl: string,
  options?: VideoAnimatedWebpOptions
): Promise<VideoAnimatedWebpResult> {
  const resolved = normalizeOptions(options);
  const webpEncoders = await detectWebpEncoders();
  const useSharpFallback = webpEncoders.length === 0;

  const tempDir = join(tmpdir(), `video-animated-webp-${randomUUID()}`);
  await mkdir(tempDir, { recursive: true });

  let smallestCandidate: VideoAnimatedWebpResult | null = null;
  let attempts = 0;

  try {
    for (const scale of DEFAULT_SCALE_STEPS) {
      const targetWidth = Math.max(64, Math.round(resolved.maxWidth * scale));
      const targetHeight = Math.max(64, Math.round(resolved.maxHeight * scale));

      for (const quality of DEFAULT_QUALITY_STEPS) {
        attempts += 1;

        let outputBuffer: Buffer;
        let outputWidth: number | undefined;
        let outputHeight: number | undefined;
        let usedEncoder: VideoAnimatedWebpEncoder;

        if (!useSharpFallback) {
          const outputPath = join(tempDir, `candidate-${attempts}.webp`);
          let generatedWith: WebpEncoderName | null = null;
          let lastError: unknown = null;

          for (const encoder of webpEncoders) {
            try {
              await runFfmpegWebpEncode({
                inputUrl: sourceUrl,
                outputPath,
                fps: resolved.fps,
                width: targetWidth,
                height: targetHeight,
                quality,
                encoder,
                loop: resolved.loop,
                timeoutMs: resolved.timeoutMs,
              });
              generatedWith = encoder;
              break;
            } catch (error) {
              lastError = error;
            }
          }

          if (!generatedWith) {
            throw (
              lastError instanceof Error
                ? lastError
                : new Error('Failed to encode animated WebP with available FFmpeg encoders')
            );
          }

          outputBuffer = await readFile(outputPath);
          const metadata = await sharp(outputBuffer, { animated: true }).metadata().catch(() => undefined);
          outputWidth = metadata?.width;
          outputHeight = metadata?.height;
          usedEncoder = generatedWith;
        } else {
          const frameDir = join(tempDir, `frames-${attempts}`);
          await mkdir(frameDir, { recursive: true });
          try {
            await runFfmpegFrameExtract({
              inputUrl: sourceUrl,
              outputDir: frameDir,
              fps: resolved.fps,
              width: targetWidth,
              height: targetHeight,
              timeoutMs: resolved.timeoutMs,
            });
            const frameBuffers = await readPngFrames(frameDir);
            const encoded = await encodeFramesWithSharp({
              frameBuffers,
              fps: resolved.fps,
              loop: resolved.loop,
              quality,
            });
            outputBuffer = encoded.buffer;
            outputWidth = encoded.width;
            outputHeight = encoded.height;
            usedEncoder = 'sharp-webp-fallback';
          } finally {
            await rm(frameDir, { recursive: true, force: true }).catch(() => {});
          }
        }

        const bytes = outputBuffer.byteLength;

        const candidate: VideoAnimatedWebpResult = {
          buffer: outputBuffer,
          bytes,
          width: outputWidth,
          height: outputHeight,
          fps: resolved.fps,
          loop: resolved.loop,
          quality,
          scale,
          maxWidth: resolved.maxWidth,
          maxHeight: resolved.maxHeight,
          maxOutputBytes: resolved.maxOutputBytes,
          timeoutMs: resolved.timeoutMs,
          attempts,
          encoder: usedEncoder,
        };

        if (!smallestCandidate || candidate.bytes < smallestCandidate.bytes) {
          smallestCandidate = candidate;
        }

        if (bytes <= resolved.maxOutputBytes) {
          return candidate;
        }
      }
    }

    if (smallestCandidate) {
      throw new Error(
        `Unable to satisfy max output size (${resolved.maxOutputBytes} bytes). Smallest candidate was ${smallestCandidate.bytes} bytes.`
      );
    }

    throw new Error('Failed to produce animated WebP output');
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
