'use client';

export type LocalVideoPreviewResult = {
  width: number;
  height: number;
  durationSeconds: number | null;
  posterUrl: string;
  frameUrls: string[];
};

export type CaptureLocalVideoPreviewOptions = {
  frameCount?: number;
  maxDimension?: number;
  metadataTimeoutMs?: number;
  seekTimeoutMs?: number;
};

const DEFAULT_FRAME_COUNT = 6;
const MAX_FRAME_COUNT = 8;
const DEFAULT_MAX_DIMENSION = 320;
const DEFAULT_METADATA_TIMEOUT_MS = 10_000;
const DEFAULT_SEEK_TIMEOUT_MS = 4_000;

const waitForVideoEvent = (video: HTMLVideoElement, eventName: string, timeoutMs: number) =>
  new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener(eventName, onEvent);
      video.removeEventListener('error', onError);
    };
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`Video failed while waiting for "${eventName}"`));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for video "${eventName}"`));
    }, timeoutMs);
    video.addEventListener(eventName, onEvent);
    video.addEventListener('error', onError);
  });

const canvasToBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Canvas frame capture produced no blob'))),
      'image/jpeg',
      0.7
    );
  });

const buildFrameTimestamps = (durationSeconds: number, frameCount: number) => {
  const count = Math.max(1, Math.min(MAX_FRAME_COUNT, Math.floor(frameCount)));
  const start = Math.min(0.5, durationSeconds * 0.05);
  const end = Math.max(start, durationSeconds - 0.1);
  const seen = new Set<number>();
  const timestamps: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const fraction = count === 1 ? 0 : index / (count - 1);
    const timestamp = start + (end - start) * fraction;
    const key = Math.round(timestamp * 10);
    if (seen.has(key)) continue;
    seen.add(key);
    timestamps.push(timestamp);
  }
  return timestamps;
};

export const captureLocalVideoPreview = async (
  file: File,
  options?: CaptureLocalVideoPreviewOptions
): Promise<LocalVideoPreviewResult> => {
  const maxDimension = options?.maxDimension ?? DEFAULT_MAX_DIMENSION;
  const metadataTimeoutMs = options?.metadataTimeoutMs ?? DEFAULT_METADATA_TIMEOUT_MS;
  const seekTimeoutMs = options?.seekTimeoutMs ?? DEFAULT_SEEK_TIMEOUT_MS;

  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';
  const frameUrls: string[] = [];

  try {
    const metadataReady = waitForVideoEvent(video, 'loadedmetadata', metadataTimeoutMs);
    video.src = objectUrl;
    await metadataReady;

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) {
      throw new Error('Video has no decodable dimensions');
    }

    const durationSeconds = Number.isFinite(video.duration) ? video.duration : null;
    const timestamps =
      durationSeconds !== null
        ? buildFrameTimestamps(durationSeconds, options?.frameCount ?? DEFAULT_FRAME_COUNT)
        : [0.1];

    const scale = Math.min(1, maxDimension / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas 2D context unavailable');
    }

    for (const timestamp of timestamps) {
      try {
        const seeked = waitForVideoEvent(video, 'seeked', seekTimeoutMs);
        video.currentTime = timestamp;
        await seeked;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const blob = await canvasToBlob(canvas);
        frameUrls.push(URL.createObjectURL(blob));
      } catch {
        // Skip frames that fail to seek/capture; fail only if none succeed.
      }
    }

    if (frameUrls.length === 0) {
      throw new Error('No video frames could be captured');
    }

    return { width, height, durationSeconds, posterUrl: frameUrls[0], frameUrls };
  } catch (error) {
    frameUrls.forEach((url) => URL.revokeObjectURL(url));
    throw error;
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
};
