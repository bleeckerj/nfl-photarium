import sharp from 'sharp';
import { getCloudflareCredentials } from '@/server/cloudflareClient';

export type AnimatedWebpFrame = {
  buffer: Buffer;
  filename?: string;
};

export type AnimatedWebpBuildOptions = {
  fps?: number;
  loop?: boolean;
  delayMs?: number;
  delays?: number[];
  quality?: number;
  effort?: number;
};

export type AnimatedWebpBuildResult = {
  buffer: Buffer;
  bytes: number;
  width: number;
  height: number;
  frameCount: number;
  delays: number[];
};

export type AnimatedWebpReverseResult = AnimatedWebpBuildResult & {
  originalFrameCount: number;
};

const DEFAULT_FPS = 1;
const DEFAULT_DELAY_MS = 1000;

const resolveDelay = (options: AnimatedWebpBuildOptions) => {
  if (typeof options.delayMs === 'number' && Number.isFinite(options.delayMs) && options.delayMs > 0) {
    return Math.max(1, Math.round(options.delayMs));
  }
  const fps = typeof options.fps === 'number' && Number.isFinite(options.fps) && options.fps > 0
    ? options.fps
    : DEFAULT_FPS;
  return Math.max(1, Math.round(1000 / fps));
};

const resolveLoop = (loop?: boolean) => (loop === false ? 1 : 0);

export async function buildAnimatedWebpFromFrames(
  frames: AnimatedWebpFrame[],
  options: AnimatedWebpBuildOptions = {}
): Promise<AnimatedWebpBuildResult> {
  if (frames.length < 2) {
    throw new Error('At least two frames are required');
  }

  const metas = await Promise.all(frames.map((frame) => sharp(frame.buffer).metadata()));
  const widths = metas.map((meta) => meta.width || 0).filter(Boolean);
  const heights = metas.map((meta) => meta.height || 0).filter(Boolean);
  const maxWidth = Math.max(...widths, 1);
  const maxHeight = Math.max(...heights, 1);
  const fallbackDelay = resolveDelay(options);

  const preparedFrames = await Promise.all(
    frames.map(async (frame) =>
      sharp(frame.buffer)
        .resize(maxWidth, maxHeight, {
          fit: 'contain',
          background: { r: 255, g: 255, b: 255, alpha: 0 },
        })
        .ensureAlpha()
        .raw()
        .toBuffer()
    )
  );

  const delays = frames.map((_frame, index) => {
    const value = options.delays?.[index];
    return typeof value === 'number' && Number.isFinite(value) && value > 0
      ? Math.max(1, Math.round(value))
      : fallbackDelay;
  });

  const stacked = Buffer.concat(preparedFrames);
  const buffer = await sharp(stacked, {
    raw: {
      width: maxWidth,
      height: maxHeight * preparedFrames.length,
      channels: 4,
      pageHeight: maxHeight,
    },
  })
    .webp({
      quality: options.quality ?? 80,
      effort: options.effort ?? 4,
      loop: resolveLoop(options.loop),
      delay: delays,
    })
    .toBuffer();

  return {
    buffer,
    bytes: buffer.byteLength,
    width: maxWidth,
    height: maxHeight,
    frameCount: frames.length,
    delays,
  };
}

export async function fetchOriginalImageBlob(imageId: string): Promise<{ buffer: Buffer; contentType?: string }> {
  const { accountId, apiToken } = getCloudflareCredentials();
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1/${imageId}/blob`,
    {
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
      cache: 'no-store',
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch original image blob (${response.status})`);
  }

  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') || undefined,
  };
}

export async function reverseAnimatedWebpBuffer(buffer: Buffer): Promise<AnimatedWebpReverseResult> {
  const metadata = await sharp(buffer, { animated: true }).metadata();
  const frameCount = Math.max(1, Math.round(metadata.pages ?? 1));
  if (frameCount < 2) {
    throw new Error('Image is not animated');
  }

  const width = metadata.width;
  const pageHeight = metadata.pageHeight;
  if (!width || !pageHeight) {
    throw new Error('Animated image dimensions could not be resolved');
  }

  const raw = await sharp(buffer, { animated: true }).ensureAlpha().raw().toBuffer();
  const frameSize = width * pageHeight * 4;
  if (raw.byteLength < frameSize * frameCount) {
    throw new Error('Animated image frame data is incomplete');
  }

  const frames = Array.from({ length: frameCount }, (_entry, index) => ({
    buffer: raw.subarray(index * frameSize, (index + 1) * frameSize),
  })).reverse();

  const rawDelay = (metadata as sharp.Metadata & { delay?: number[] }).delay;
  const sourceDelays = Array.isArray(rawDelay) && rawDelay.length
    ? rawDelay.map((value) => (Number.isFinite(value) && value > 0 ? Math.round(value) : DEFAULT_DELAY_MS))
    : Array(frameCount).fill(DEFAULT_DELAY_MS);
  const delays = [...sourceDelays].reverse();

  const stacked = Buffer.concat(frames.map((frame) => frame.buffer));
  const output = await sharp(stacked, {
    raw: {
      width,
      height: pageHeight * frameCount,
      channels: 4,
      pageHeight,
    },
  })
    .webp({
      quality: 80,
      effort: 4,
      loop: 0,
      delay: delays,
    })
    .toBuffer();

  return {
    buffer: output,
    bytes: output.byteLength,
    width,
    height: pageHeight,
    frameCount,
    originalFrameCount: frameCount,
    delays,
  };
}
