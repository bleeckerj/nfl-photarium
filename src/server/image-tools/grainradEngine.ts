// In-process bridge between Photarium (sharp I/O) and the grainrad effects
// engine (pure-JS pixel transforms). This replaces the previous HTTP/ffmpeg
// adapter: sharp owns decode/encode, grainrad owns the effect.
//
//   bytes(any format) --sharp--> RGBA raster --> grainrad.render() -->
//   RGBA raster --sharp / ffmpeg--> bytes(target format)
//
// There is no grainrad webservice and no ffmpeg decode of the source. sharp's
// libwebp/libaom decoders handle WebP/AVIF/PNG/JPEG/GIF robustly, which is the
// fix for the "[webp] image data not found" ffmpeg failures.
//
// Animated image sources (GIF / animated WebP) are decoded frame-by-frame for
// animated exports, so the source's own motion is preserved through the effect;
// still exports use the first frame.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import sharp from 'sharp';
import {
  createFrameRenderContext,
  createEffectsApi,
  getTimelineFrameCount,
  normalizeTimeline,
  type EffectsApi,
  type RasterImage,
} from 'nfl-grainrad-clone';

import type { ImageToolRequest } from '@/server/image-tools/types';

// Single shared engine/facade instance for the process.
let apiSingleton: EffectsApi | null = null;
const getApi = (): EffectsApi => {
  if (!apiSingleton) apiSingleton = createEffectsApi();
  return apiSingleton;
};

export type GrainradArtifact = {
  buffer: Buffer;
  contentType: string;
  filename: string;
};

export type GrainradRenderProgress = {
  phase: 'decode' | 'render' | 'frame' | 'encode';
  message: string;
  percent?: number;
  details?: Record<string, string | number | boolean | null | undefined>;
};

type GrainradRenderOptions = {
  onProgress?: (progress: GrainradRenderProgress) => void | Promise<void>;
};

// Preset -> longest-edge cap, to bound CPU/memory on large sources. Stills and
// previews downscale; high-quality keeps native resolution for lightweight effects.
const PRESET_MAX_DIM: Record<string, number | undefined> = {
  preview: 512,
  balanced: 1600,
  'high-quality': undefined,
};

// RGB-display rendering performs multiple glow/resampling passes per pixel.
// Running it at full export size in the Next process can starve status routes,
// which makes queued/running jobs look hung in the UI.
const CPU_HEAVY_STILL_EFFECT_MAX_DIM: Record<string, Record<string, number | undefined>> = {
  'rgb-subpixel-display': {
    preview: 512,
    balanced: 1024,
    'high-quality': 1600,
  },
};

const CPU_HEAVY_ANIMATED_EFFECT_MAX_DIM: Record<string, Record<string, number | undefined>> = {
  'rgb-subpixel-display': {
    preview: 256,
    balanced: 384,
    'high-quality': 512,
  },
};

const PRESET_QUALITY: Record<string, number> = {
  preview: 70,
  balanced: 82,
  'high-quality': 92,
};

const VERTICAL_HOLD_EFFECT_DEFAULTS: Record<string, {
  verticalHoldAmount: number;
  verticalHoldSpeed: number;
  verticalHoldPhase: number;
  verticalHoldRollAmount: number;
  verticalHoldBandHeight: number;
}> = {
  vhs: {
    verticalHoldAmount: 0,
    verticalHoldSpeed: 0.15,
    verticalHoldPhase: 0,
    verticalHoldRollAmount: 1,
    verticalHoldBandHeight: 0.08,
  },
  'rgb-subpixel-display': {
    verticalHoldAmount: 0,
    verticalHoldSpeed: 0.15,
    verticalHoldPhase: 0,
    verticalHoldRollAmount: 1,
    verticalHoldBandHeight: 0.08,
  },
};

const VERTICAL_HOLD_ROLL_PARAM_KEYS = [
  'verticalHoldSpeed',
  'verticalHoldPhase',
  'verticalHoldRollAmount',
] as const;

const VERTICAL_HOLD_FULL_LOOP_PARAM = 'verticalHoldFullLoop';
const INVISIBLE_VERTICAL_HOLD_VALUE = Number.EPSILON;

const RGB_SUBPIXEL_PARAM_PRESET_OVERRIDES: Record<
  string,
  Partial<typeof VERTICAL_HOLD_EFFECT_DEFAULTS['rgb-subpixel-display']>
> = {
  'diagonal-tear-hold-soft-wave-medium': {
    verticalHoldSpeed: 0.25,
    verticalHoldRollAmount: 1,
  },
};

const STILL_CONTENT_TYPE: Record<string, string> = {
  png: 'image/png',
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

const ANIMATED_CONTENT_TYPE: Record<string, string> = {
  gif: 'image/gif',
  webp: 'image/webp',
  mp4: 'video/mp4',
};

const normalizeFormat = (format: string) => format.trim().toLowerCase();

const resolvePreset = (preset?: string) => (preset && preset in PRESET_MAX_DIM ? preset : 'balanced');

const hasOwnParam = (params: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(params, key);

const finiteNumberParam = (value: unknown) => (
  typeof value === 'number' && Number.isFinite(value) ? value : undefined
);

const verticalHoldParamValue = (
  params: Record<string, unknown>,
  key: keyof typeof VERTICAL_HOLD_EFFECT_DEFAULTS['vhs'],
  fallback: number
) => finiteNumberParam(params[key]) ?? fallback;

const booleanParam = (value: unknown) => value === true || value === 'true';

const stripPhotariumOnlyParams = (params: Record<string, unknown>) => {
  if (!hasOwnParam(params, VERTICAL_HOLD_FULL_LOOP_PARAM)) return params;
  const nextParams = { ...params };
  delete nextParams[VERTICAL_HOLD_FULL_LOOP_PARAM];
  return nextParams;
};

const usesVerticalHoldFullLoop = (request: ImageToolRequest) =>
  booleanParam((request.params ?? {})[VERTICAL_HOLD_FULL_LOOP_PARAM]);

const verticalHoldPresetParamValue = (
  request: ImageToolRequest,
  key: keyof typeof VERTICAL_HOLD_EFFECT_DEFAULTS['vhs']
) => {
  if (request.effectId !== 'rgb-subpixel-display' || !request.paramPreset) return undefined;
  return finiteNumberParam(RGB_SUBPIXEL_PARAM_PRESET_OVERRIDES[request.paramPreset]?.[key]);
};

const resolvedVerticalHoldParamValue = (
  request: ImageToolRequest,
  key: keyof typeof VERTICAL_HOLD_EFFECT_DEFAULTS['vhs']
) => {
  const defaults = VERTICAL_HOLD_EFFECT_DEFAULTS[request.effectId];
  if (!defaults) return undefined;

  const params = request.params ?? {};
  return finiteNumberParam(params[key])
    ?? verticalHoldPresetParamValue(request, key)
    ?? defaults[key];
};

const resolveVerticalHoldFullLoopTimeline = (
  request: ImageToolRequest,
  timeline: ImageToolRequest['timeline']
): ImageToolRequest['timeline'] => {
  if (!usesVerticalHoldFullLoop(request)) return timeline;

  const speed = resolvedVerticalHoldParamValue(request, 'verticalHoldSpeed');
  if (!speed) return timeline;

  const fps = normalizeTimeline({ ...(timeline ?? {}), mode: 'animated' }, request.renderContext ?? {}).fps;
  const framesPerCycle = Math.max(2, Math.round(fps / Math.abs(speed)));
  const durationMs = Math.round((framesPerCycle / fps) * 1000);

  return {
    ...(timeline ?? {}),
    durationMs,
    loop: true,
  };
};

const usesIndependentVerticalHoldRoll = (request: ImageToolRequest) => {
  const defaults = VERTICAL_HOLD_EFFECT_DEFAULTS[request.effectId];
  if (!defaults) return false;

  const params = request.params ?? {};
  if (usesVerticalHoldFullLoop(request)) return true;

  const rollAmount = verticalHoldParamValue(params, 'verticalHoldRollAmount', defaults.verticalHoldRollAmount);
  if (rollAmount <= 0) return false;

  const rollOverrideChanged = VERTICAL_HOLD_ROLL_PARAM_KEYS.some((key) => (
    hasOwnParam(params, key) && verticalHoldParamValue(params, key, defaults[key]) !== defaults[key]
  ));
  const explicitBandDisabled = (
    (hasOwnParam(params, 'verticalHoldAmount')
      && verticalHoldParamValue(params, 'verticalHoldAmount', defaults.verticalHoldAmount) <= 0)
    || (hasOwnParam(params, 'verticalHoldBandHeight')
      && verticalHoldParamValue(params, 'verticalHoldBandHeight', defaults.verticalHoldBandHeight) <= 0)
  );

  return rollOverrideChanged || (Boolean(request.paramPreset) && explicitBandDisabled);
};

const buildRenderParams = (request: ImageToolRequest) => {
  const defaults = VERTICAL_HOLD_EFFECT_DEFAULTS[request.effectId];
  if (!defaults || !usesIndependentVerticalHoldRoll(request)) {
    return stripPhotariumOnlyParams(request.params);
  }

  const params = request.params ?? {};
  const fullLoop = usesVerticalHoldFullLoop(request);
  const amount = verticalHoldParamValue(params, 'verticalHoldAmount', defaults.verticalHoldAmount);
  const bandHeight = verticalHoldParamValue(params, 'verticalHoldBandHeight', defaults.verticalHoldBandHeight);
  if (amount > 0 && bandHeight > 0) {
    return stripPhotariumOnlyParams(fullLoop ? { ...params, verticalHoldRollAmount: 1 } : params);
  }

  const nextParams = { ...params };
  if (fullLoop) {
    nextParams.verticalHoldRollAmount = 1;
  }
  if (amount <= 0 || bandHeight <= 0) {
    nextParams.verticalHoldAmount = INVISIBLE_VERTICAL_HOLD_VALUE;
  }
  if (bandHeight <= 0) {
    nextParams.verticalHoldBandHeight = INVISIBLE_VERTICAL_HOLD_VALUE;
  }
  return stripPhotariumOnlyParams(nextParams);
};

export const resolveGrainradMaxDim = (request: ImageToolRequest) => {
  const preset = resolvePreset(request.output.preset);
  const effectCaps = request.output.mode === 'animated'
    ? CPU_HEAVY_ANIMATED_EFFECT_MAX_DIM
    : CPU_HEAVY_STILL_EFFECT_MAX_DIM;
  return effectCaps[request.effectId]?.[preset] ?? PRESET_MAX_DIM[preset];
};

const reportProgress = async (
  options: GrainradRenderOptions | undefined,
  progress: GrainradRenderProgress
) => {
  await options?.onProgress?.(progress);
};

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

// ---- sharp <-> grainrad raster bridging ------------------------------------

/**
 * Decode arbitrary image bytes to an RGBA raster using sharp. Flattens animated
 * inputs to their first frame and optionally downscales to `maxDim`.
 */
export const decodeToRaster = async (
  buffer: Buffer,
  options: { maxDim?: number } = {}
): Promise<RasterImage> => {
  let pipeline = sharp(buffer, { failOn: 'none' }).ensureAlpha();
  if (options.maxDim) {
    pipeline = pipeline.resize(options.maxDim, options.maxDim, {
      fit: 'inside',
      withoutEnlargement: true,
    });
  }
  let decoded;
  try {
    decoded = await pipeline.raw().toBuffer({ resolveWithObject: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Grainrad could not decode the source image: ${detail}`);
  }
  const { data, info } = decoded;
  const { createRasterImage } = await import('nfl-grainrad-clone');
  return createRasterImage(info.width, info.height, new Uint8ClampedArray(data));
};

export type AnimatedSourceRasters = {
  frames: RasterImage[];
  frameDelaysMs: number[];
  totalDurationMs: number;
  sourceFps: number;
};

// Browsers treat a 0/undefined GIF frame delay as ~100ms; mirror that.
const DEFAULT_FRAME_DELAY_MS = 100;

const normalizeFrameDelay = (value: unknown) => (
  typeof value === 'number' && Number.isFinite(value) && value >= 10 ? value : DEFAULT_FRAME_DELAY_MS
);

/**
 * Decode an animated image source (GIF / animated WebP) to one RGBA raster per
 * frame, preserving per-frame delays. Returns null for single-frame sources so
 * callers can fall back to the still path.
 */
export const decodeAnimatedSourceToRasters = async (
  buffer: Buffer,
  options: { maxDim?: number } = {}
): Promise<AnimatedSourceRasters | null> => {
  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(buffer, { failOn: 'none', animated: true }).metadata();
  } catch {
    return null;
  }
  const pages = metadata.pages ?? 1;
  if (pages <= 1) return null;

  let pipeline = sharp(buffer, { failOn: 'none', animated: true }).ensureAlpha();
  if (options.maxDim) {
    pipeline = pipeline.resize(options.maxDim, options.maxDim, {
      fit: 'inside',
      withoutEnlargement: true,
    });
  }
  let decoded;
  try {
    decoded = await pipeline.raw().toBuffer({ resolveWithObject: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Grainrad could not decode the animated source: ${detail}`);
  }
  const { data, info } = decoded;
  // Animated rasters come back as a vertical strip of `pages` frames.
  const frameHeight = info.height / pages;
  if (!Number.isInteger(frameHeight) || frameHeight <= 0) return null;

  const { createRasterImage } = await import('nfl-grainrad-clone');
  const frameBytes = info.width * frameHeight * 4;
  const frames: RasterImage[] = [];
  for (let page = 0; page < pages; page += 1) {
    const slice = data.subarray(page * frameBytes, (page + 1) * frameBytes);
    frames.push(createRasterImage(info.width, frameHeight, new Uint8ClampedArray(slice)));
  }

  const rawDelays = Array.isArray(metadata.delay) ? metadata.delay : [];
  const frameDelaysMs = frames.map((_, index) => normalizeFrameDelay(rawDelays[index]));
  const totalDurationMs = frameDelaysMs.reduce((sum, delay) => sum + delay, 0);
  return {
    frames,
    frameDelaysMs,
    totalDurationMs,
    sourceFps: 1000 / (totalDurationMs / frames.length),
  };
};

/**
 * Pick the source frame visible at `timeSeconds`, honoring per-frame delays.
 * Looping wraps time over the source duration; otherwise the last frame holds.
 */
export const sourceFrameIndexAtTime = (
  source: AnimatedSourceRasters,
  timeSeconds: number,
  loop: boolean
) => {
  const total = source.totalDurationMs;
  let t = Math.max(0, timeSeconds * 1000);
  if (loop) {
    t %= total;
  } else if (t >= total) {
    return source.frames.length - 1;
  }
  let elapsed = 0;
  for (let index = 0; index < source.frames.length; index += 1) {
    elapsed += source.frameDelaysMs[index];
    if (t < elapsed) return index;
  }
  return source.frames.length - 1;
};

const rasterToSharp = (raster: RasterImage) =>
  sharp(Buffer.from(raster.data), {
    raw: { width: raster.width, height: raster.height, channels: 4 },
  });

const encodeStill = async (
  raster: RasterImage,
  format: string,
  quality: number
): Promise<Buffer> => {
  const pipeline = rasterToSharp(raster);
  switch (format) {
    case 'webp':
      return pipeline.webp({ quality }).toBuffer();
    case 'jpg':
    case 'jpeg':
      return pipeline.jpeg({ quality }).toBuffer();
    case 'png':
    default:
      return pipeline.png().toBuffer();
  }
};

// Stack same-size RGBA frames into one tall raw buffer for sharp's paged
// animation encoder.
const stackFrames = (frames: RasterImage[]) =>
  Buffer.concat(frames.map((frame) => Buffer.from(frame.data)));

const encodeAnimatedSharp = async (
  frames: RasterImage[],
  format: 'gif' | 'webp',
  fps: number,
  loop: boolean,
  quality: number
): Promise<Buffer> => {
  const { width, height } = frames[0];
  const stacked = stackFrames(frames);
  const delayMs = Math.max(1, Math.round(1000 / Math.max(1, fps)));
  const base = sharp(stacked, {
    raw: { width, height: height * frames.length, channels: 4, pageHeight: height },
  });
  const delays = frames.map(() => delayMs);
  const loopValue = loop ? 0 : 1;
  if (format === 'gif') {
    return base.gif({ loop: loopValue, delay: delays }).toBuffer();
  }
  return base.webp({ quality, loop: loopValue, delay: delays }).toBuffer();
};

const encodeMp4 = async (frames: RasterImage[], fps: number): Promise<Buffer> => {
  const { width, height } = frames[0];
  const stacked = stackFrames(frames);
  const outPath = join(tmpdir(), `grainrad-${randomUUID()}.mp4`);
  const args = [
    '-v', 'error',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-s', `${width}x${height}`,
    '-framerate', String(Math.max(1, fps)),
    '-i', 'pipe:0',
    // libx264 + yuv420p require even dimensions.
    '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-y', outPath,
  ];
  try {
    await runFfmpeg(args, stacked);
    return await readFile(outPath);
  } finally {
    await rm(outPath, { force: true });
  }
};

const runFfmpeg = (args: string[], stdin: Buffer): Promise<void> =>
  new Promise((resolve, reject) => {
    const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
    let child;
    try {
      child = spawn(ffmpegPath, args);
    } catch {
      reject(new Error('MP4 export requires ffmpeg on the host (set FFMPEG_PATH or install ffmpeg).'));
      return;
    }
    const stderr: Buffer[] = [];
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        reject(new Error('MP4 export requires ffmpeg on the host (set FFMPEG_PATH or install ffmpeg).'));
      } else {
        reject(error);
      }
    });
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${Buffer.concat(stderr).toString('utf8').slice(0, 400)}`));
    });
    child.stdin.on('error', () => {
      /* ignore EPIPE if ffmpeg exits early; the close handler reports the real error */
    });
    child.stdin.end(stdin);
  });

// ---- public entrypoints -----------------------------------------------------

function assertImageOutput(
  result: { kind: string; value: unknown },
  effectId: string
): asserts result is { kind: 'image'; value: RasterImage } {
  if (result.kind !== 'image') {
    throw new Error(
      `Effect "${effectId}" produced "${result.kind}" output, which cannot be exported as an image.`
    );
  }
}

const buildFilename = (effectId: string, ext: string) => `grainrad-${effectId}.${ext}`;

/**
 * Render a still image artifact entirely in-process.
 */
export const renderStill = async (
  sourceBuffer: Buffer,
  request: ImageToolRequest,
  options: GrainradRenderOptions = {}
): Promise<GrainradArtifact> => {
  const format = normalizeFormat(request.output.format);
  const contentType = STILL_CONTENT_TYPE[format];
  if (!contentType) throw new Error(`Unsupported still format "${request.output.format}".`);

  const preset = resolvePreset(request.output.preset);
  const maxDim = resolveGrainradMaxDim(request);
  await reportProgress(options, {
    phase: 'decode',
    message: 'Decoding source raster',
    percent: 0.15,
    details: { maxDim: maxDim ?? null },
  });
  const raster = await decodeToRaster(sourceBuffer, { maxDim });

  await reportProgress(options, {
    phase: 'render',
    message: 'Rendering Grainrad still frame',
    percent: 0.5,
    details: { width: raster.width, height: raster.height },
  });
  await yieldToEventLoop();
  const result = getApi().renderRaster({
    source: raster,
    effect: request.effectId,
    paramPreset: request.paramPreset,
    params: buildRenderParams(request),
    renderContext: request.renderContext ?? {},
  });
  assertImageOutput(result, request.effectId);

  await reportProgress(options, {
    phase: 'encode',
    message: `Encoding ${format.toUpperCase()} artifact`,
    percent: 0.85,
  });
  const buffer = await encodeStill(result.value, format, PRESET_QUALITY[preset]);
  const ext = format === 'jpeg' ? 'jpg' : format;
  return { buffer, contentType, filename: buildFilename(request.effectId, ext) };
};

/**
 * Render an animated artifact (GIF/WebP via sharp, MP4 via host ffmpeg).
 */
export const renderAnimated = async (
  sourceBuffer: Buffer,
  request: ImageToolRequest,
  options: GrainradRenderOptions = {}
): Promise<GrainradArtifact> => {
  const format = normalizeFormat(request.output.format);
  const contentType = ANIMATED_CONTENT_TYPE[format];
  if (!contentType) throw new Error(`Unsupported animated format "${request.output.format}".`);

  const preset = resolvePreset(request.output.preset);
  const maxDim = resolveGrainradMaxDim(request);
  await reportProgress(options, {
    phase: 'decode',
    message: 'Decoding source raster',
    percent: 0.15,
    details: { maxDim: maxDim ?? null },
  });
  // Animated image sources (GIF / animated WebP) keep their motion: every
  // source frame is decoded and the effect samples the frame visible at each
  // output timestamp. Single-frame sources fall back to the still raster and
  // animate purely through the effect's time-driven params.
  const animatedSource = await decodeAnimatedSourceToRasters(sourceBuffer, { maxDim });
  const raster = animatedSource
    ? animatedSource.frames[0]
    : await decodeToRaster(sourceBuffer, { maxDim });

  let timeline = resolveVerticalHoldFullLoopTimeline(request, request.timeline);
  if (animatedSource) {
    // Default the export timeline to the source's own cadence and length when
    // the request leaves them unset, so a GIF round-trips at its native motion.
    timeline = {
      ...(timeline ?? {}),
      fps: timeline?.fps ?? Math.round(animatedSource.sourceFps),
      durationMs: timeline?.durationMs ?? animatedSource.totalDurationMs,
    };
  }
  const renderParams = buildRenderParams(request);
  const animatedTimeline = { ...(timeline ?? {}), mode: 'animated' as const };
  const normalizedTimeline = normalizeTimeline(animatedTimeline, request.renderContext ?? {});
  const frameCount = getTimelineFrameCount(normalizedTimeline);
  const frames: RasterImage[] = [];

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const displayFrame = frameIndex + 1;
    await reportProgress(options, {
      phase: 'frame',
      message: `Rendering Grainrad frame ${displayFrame} of ${frameCount}`,
      percent: 0.2 + (frameIndex / frameCount) * 0.62,
      details: {
        frameIndex: displayFrame,
        frameCount,
        width: raster.width,
        height: raster.height,
        sourceFrameCount: animatedSource?.frames.length ?? 1,
      },
    });
    await yieldToEventLoop();

    const renderContext = createFrameRenderContext(request.renderContext ?? {}, normalizedTimeline, frameIndex);
    const sourceRaster = animatedSource
      ? animatedSource.frames[
          sourceFrameIndexAtTime(animatedSource, renderContext.time ?? 0, normalizedTimeline.loop)
        ]
      : raster;
    const result = getApi().renderRaster({
      source: sourceRaster,
      effect: request.effectId,
      paramPreset: request.paramPreset,
      params: renderParams,
      renderContext,
    });
    assertImageOutput(result, request.effectId);
    frames.push(result.value);

    await reportProgress(options, {
      phase: 'frame',
      message: `Rendered Grainrad frame ${displayFrame} of ${frameCount}`,
      percent: 0.2 + (displayFrame / frameCount) * 0.62,
      details: {
        frameIndex: displayFrame,
        frameCount,
        time: renderContext.time ?? 0,
      },
    });
    await yieldToEventLoop();
  }
  if (frames.length === 0) throw new Error('Grainrad produced no frames for the animated export.');

  await reportProgress(options, {
    phase: 'encode',
    message: `Encoding animated ${format.toUpperCase()} artifact`,
    percent: 0.88,
    details: { frameCount: frames.length },
  });
  let buffer: Buffer;
  if (format === 'mp4') {
    buffer = await encodeMp4(frames, normalizedTimeline.fps);
  } else if (frames.length < 2) {
    // A single-frame animation degrades to a still in the same container.
    buffer = await encodeStill(frames[0], format === 'gif' ? 'png' : format, PRESET_QUALITY[preset]);
  } else {
    buffer = await encodeAnimatedSharp(
      frames,
      format as 'gif' | 'webp',
      normalizedTimeline.fps,
      normalizedTimeline.loop,
      PRESET_QUALITY[preset]
    );
  }

  return { buffer, contentType, filename: buildFilename(request.effectId, format) };
};

/**
 * Single entrypoint used by the adapter: still or animated based on output.mode.
 */
export const renderGrainradArtifact = async (
  sourceBuffer: Buffer,
  request: ImageToolRequest,
  options: GrainradRenderOptions = {}
): Promise<GrainradArtifact> =>
  request.output.mode === 'animated'
    ? renderAnimated(sourceBuffer, request, options)
    : renderStill(sourceBuffer, request, options);

export const listGrainradEffects = () => getApi().listEffects();
