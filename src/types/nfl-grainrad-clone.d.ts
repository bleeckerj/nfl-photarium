// Ambient declarations for the in-process grainrad effects engine.
// grainrad ships as zero-dependency ESM JavaScript with no bundled types; this
// declares the minimal surface Photarium consumes via src/server/image-tools.
declare module 'nfl-grainrad-clone' {
  export type RasterImage = {
    width: number;
    height: number;
    data: Uint8ClampedArray;
  };

  export type RenderContext = {
    time?: number;
    frameIndex?: number;
    fps?: number;
    seed?: number;
  };

  export type Timeline = {
    durationMs?: number;
    fps?: number;
    loop?: boolean;
    mode?: 'still' | 'animated';
    seed?: number;
    sourceTimeMode?: 'synthetic' | 'source-video' | 'live';
  };

  export type EngineRenderResult = {
    kind: 'image' | 'ascii' | string;
    value: RasterImage | unknown;
    metadata?: Record<string, unknown>;
  };

  export type EffectSummary = {
    id: string;
    name: string;
    description?: string;
    outputKind?: string;
    status?: string;
  };

  export function createRasterImage(
    width: number,
    height: number,
    data?: Uint8ClampedArray
  ): RasterImage;

  export interface GrainradEngine {
    render(
      image: RasterImage,
      effectId: string,
      params?: Record<string, unknown>,
      renderContext?: RenderContext
    ): EngineRenderResult;
    listEffects(): EffectSummary[];
  }

  export function createDefaultEngine(): GrainradEngine;

  export type RasterSequenceResult = {
    frames: RasterImage[];
    fps: number;
    loop: boolean;
    frameCount: number;
  };

  export interface EffectsApi {
    listEffects(): EffectSummary[];
    describeEffect(effectId: string): unknown;
    renderRaster(args: {
      source: RasterImage;
      effect: string;
      params?: Record<string, unknown>;
      paramPreset?: string;
      renderContext?: RenderContext;
    }): EngineRenderResult;
    renderRasterSequence(args: {
      source: RasterImage;
      effect: string;
      params?: Record<string, unknown>;
      paramPreset?: string;
      timeline?: { durationMs?: number; fps?: number; loop?: boolean };
      renderContext?: RenderContext;
    }): Promise<RasterSequenceResult>;
  }

  export function createEffectsApi(options?: unknown): EffectsApi;
  export function createPhotariumImageToolManifest(options?: unknown): unknown;
  export function createPhotariumEightBitReinterpretationManifest(options?: unknown): unknown;
  export function runEightBitPhotariumWorkflow(options?: unknown): Promise<{
    kind: 'image' | string;
    mode: string;
    styleStrength: string;
    prompt: string | null;
    generated: unknown;
    rendered: {
      kind: 'image' | string;
      png?: Buffer | Uint8Array;
      width?: number;
      height?: number;
      metadata?: Record<string, unknown>;
    };
  }>;
  export function normalizeTimeline(timeline?: Timeline, renderContext?: RenderContext): Required<Timeline>;
  export function getTimelineFrameCount(timeline?: Timeline): number;
  export function createFrameRenderContext(
    renderContext?: RenderContext,
    timeline?: Timeline,
    frameIndex?: number
  ): RenderContext;
}
