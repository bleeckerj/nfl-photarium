import sharp from 'sharp';

import { downloadOriginalImageById, getImage } from '../discovery/client.js';
import { BASE_URL } from '../shared/config.js';
import { normalizeManualPrompt } from '../shared/prompts.js';
import {
  camelizeUploadStem,
  cleanUploadFilename,
  extensionFromFilename,
  withExtension,
} from './filenames.js';

export type CropVariantAnchor = 'top' | 'center' | 'bottom';

export type CropVariantOptions = {
  imageId: string;
  aspectRatio?: string;
  anchor?: CropVariantAnchor;
  quality?: number;
  filename?: string;
  folder?: string;
  createFolder?: boolean;
  tags?: string[];
  description?: string;
  prompt?: string;
  originalUrl?: string;
  sourceUrl?: string;
  namespace?: string;
  parentId?: string;
};

export type CropGeometry = {
  width: number;
  height: number;
  aspectRatio: string;
  anchor: CropVariantAnchor;
  x: number;
  y: number;
};

export type CropVariantResult = Record<string, unknown> & {
  sourceImageId: string;
  sourceWidth: number;
  sourceHeight: number;
  crop: CropGeometry;
  animated?: {
    frameCount: number;
    delaysPreserved: boolean;
  };
  bytes: number;
  mimeType: 'image/webp';
};

type SourceImageMetadata = {
  filename?: string | null;
  namespace?: string | null;
  tags?: string[];
  description?: string | null;
  originalUrl?: string | null;
  sourceUrl?: string | null;
};

const DEFAULT_ASPECT_RATIO = '4:5';
const DEFAULT_QUALITY = 90;
const DEFAULT_DELAY_MS = 1000;

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function pickTags(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).map((entry) => entry.trim())
    : undefined;
}

function readSourceMetadata(value: Record<string, unknown> | null): SourceImageMetadata {
  if (!value) return {};
  return {
    filename: pickString(value.filename),
    namespace: pickString(value.namespace),
    tags: pickTags(value.tags),
    description: pickString(value.description),
    originalUrl: pickString(value.originalUrl),
    sourceUrl: pickString(value.sourceUrl),
  };
}

export function parseAspectRatio(value: string = DEFAULT_ASPECT_RATIO): { label: string; width: number; height: number } {
  const normalized = value.trim().replace(/\s+/g, '');
  const match = normalized.match(/^(\d+(?:\.\d+)?)(?::|\/|x)(\d+(?:\.\d+)?)$/i);
  if (!match) {
    throw new Error(`Invalid aspectRatio "${value}". Use a ratio like "4:5", "1:1", or "9:16".`);
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`Invalid aspectRatio "${value}". Ratio numbers must be positive.`);
  }

  return {
    label: `${match[1]}:${match[2]}`,
    width,
    height,
  };
}

export function normalizeCropAnchor(value?: string): CropVariantAnchor {
  const normalized = (value || 'bottom').trim().toLowerCase();
  if (normalized === 'top' || normalized === 'center' || normalized === 'bottom') {
    return normalized;
  }
  throw new Error(`Invalid anchor "${value}". Supported anchors are "top", "center", and "bottom".`);
}

export function computeWidthPreservingCrop(options: {
  sourceWidth: number;
  sourceHeight: number;
  aspectRatio?: string;
  anchor?: string;
}): CropGeometry {
  const { sourceWidth, sourceHeight } = options;
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error('Source image dimensions could not be resolved.');
  }

  const ratio = parseAspectRatio(options.aspectRatio);
  const targetWidth = Math.round(sourceWidth);
  const targetHeight = Math.round(targetWidth * ratio.height / ratio.width);
  if (targetHeight > sourceHeight) {
    throw new Error(
      `Requested ${ratio.label} full-width crop needs ${targetHeight}px height, but source height is ${sourceHeight}px.`
    );
  }

  const anchor = normalizeCropAnchor(options.anchor);
  const remaining = Math.round(sourceHeight) - targetHeight;
  const y = anchor === 'top' ? 0 : anchor === 'center' ? Math.floor(remaining / 2) : remaining;

  return {
    width: targetWidth,
    height: targetHeight,
    aspectRatio: ratio.label,
    anchor,
    x: 0,
    y,
  };
}

function resolveQuality(value?: number): number {
  if (value === undefined) return DEFAULT_QUALITY;
  if (!Number.isFinite(value) || value <= 0 || value > 100) {
    throw new Error('quality must be a number between 1 and 100.');
  }
  return Math.round(value);
}

function outputFilename(options: { requested?: string; sourceFilename?: string | null; aspectRatio: string; anchor: CropVariantAnchor }): {
  filename: string;
  displayName: string;
} {
  const source = options.requested || options.sourceFilename || 'CroppedVariant.webp';
  const cleaned = cleanUploadFilename(source);
  const withoutExt = cleaned.replace(/\.[^.]+$/, '');
  const ratioToken = options.aspectRatio.replace(/[^A-Za-z0-9]+/g, 'x');
  const explicitExt = extensionFromFilename(cleaned);
  const baseStem = options.requested
    ? withoutExt
    : `${withoutExt}_${ratioToken}_${options.anchor}_crop`;
  const semanticStem = camelizeUploadStem(baseStem);
  const filename = withExtension(semanticStem || 'CroppedVariant', explicitExt || '.webp').replace(/\.[^.]+$/i, '.webp');
  return {
    filename,
    displayName: filename.replace(/\.[^.]+$/, ''),
  };
}

async function cropStillImage(buffer: Buffer, crop: CropGeometry, quality: number): Promise<Buffer> {
  return sharp(buffer, { failOn: 'none' })
    .extract({ left: crop.x, top: crop.y, width: crop.width, height: crop.height })
    .webp({ quality })
    .toBuffer();
}

async function cropAnimatedImage(
  buffer: Buffer,
  crop: CropGeometry,
  quality: number,
  frameCount: number,
  delays: number[],
  loop: number
): Promise<Buffer> {
  const raw = await sharp(buffer, { animated: true, failOn: 'none' }).ensureAlpha().raw().toBuffer();
  const metadata = await sharp(buffer, { animated: true, failOn: 'none' }).metadata();
  const sourceWidth = metadata.width;
  const pageHeight = metadata.pageHeight ?? metadata.height;
  if (!sourceWidth || !pageHeight) {
    throw new Error('Animated image dimensions could not be resolved.');
  }

  const frameSize = sourceWidth * pageHeight * 4;
  if (raw.byteLength < frameSize * frameCount) {
    throw new Error('Animated image frame data is incomplete.');
  }

  const frames: Buffer[] = [];
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const frame = raw.subarray(frameIndex * frameSize, (frameIndex + 1) * frameSize);
    const cropped = await sharp(frame, {
      raw: {
        width: sourceWidth,
        height: pageHeight,
        channels: 4,
      },
    })
      .extract({ left: crop.x, top: crop.y, width: crop.width, height: crop.height })
      .raw()
      .toBuffer();
    frames.push(cropped);
  }

  return sharp(Buffer.concat(frames), {
    raw: {
      width: crop.width,
      height: crop.height * frameCount,
      channels: 4,
      pageHeight: crop.height,
    },
  })
    .webp({
      quality,
      loop,
      delay: delays,
    })
    .toBuffer();
}

async function uploadCroppedBuffer(options: {
  buffer: Buffer;
  filename: string;
  displayName: string;
  folder?: string;
  createFolder?: boolean;
  tags?: string[];
  description?: string;
  prompt?: string;
  originalUrl?: string;
  sourceUrl?: string;
  namespace?: string;
  parentId: string;
}): Promise<Record<string, unknown>> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(options.buffer)], { type: 'image/webp' }), options.filename);
  form.append('displayName', options.displayName);
  if (options.folder) form.append('folder', options.folder);
  if (options.createFolder) form.append('createFolder', 'true');
  if (options.tags?.length) form.append('tags', options.tags.join(','));
  if (options.description) form.append('description', options.description);
  const prompt = normalizeManualPrompt(options.prompt);
  if (prompt) form.append('prompt', prompt);
  if (options.originalUrl) form.append('originalUrl', options.originalUrl);
  if (options.sourceUrl) form.append('sourceUrl', options.sourceUrl);
  if (options.namespace) form.append('namespace', options.namespace);
  form.append('parentId', options.parentId);

  const response = await fetch(`${BASE_URL}/api/upload`, {
    method: 'POST',
    body: form,
  });
  const rawText = await response.text();
  let result: Record<string, unknown>;
  try {
    result = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
  } catch {
    result = { raw: rawText };
  }
  if (!response.ok) {
    throw new Error((result.error as string | undefined) || `Upload failed (${response.status})`);
  }
  return result;
}

export async function cropPhotariumVariant(options: CropVariantOptions): Promise<CropVariantResult> {
  if (!options.imageId || typeof options.imageId !== 'string') {
    throw new Error('imageId is required.');
  }

  const sourceImage = readSourceMetadata(await getImage(options.imageId));
  const download = await downloadOriginalImageById(options.imageId);
  const sourceBuffer = Buffer.from(download.base64, 'base64');
  if (sourceBuffer.byteLength === 0) {
    throw new Error(`Source image ${options.imageId} downloaded as an empty file.`);
  }

  const metadata = await sharp(sourceBuffer, { animated: true, failOn: 'none' }).metadata();
  const sourceWidth = metadata.width;
  const sourceHeight = metadata.pageHeight ?? metadata.height;
  if (!sourceWidth || !sourceHeight) {
    throw new Error(`Source image ${options.imageId} dimensions could not be resolved.`);
  }

  const frameCount = Math.max(1, Math.round(metadata.pages ?? 1));
  const crop = computeWidthPreservingCrop({
    sourceWidth,
    sourceHeight,
    aspectRatio: options.aspectRatio,
    anchor: options.anchor,
  });
  const quality = resolveQuality(options.quality);
  const rawDelays = (metadata as sharp.Metadata & { delay?: number[] }).delay;
  const delays = Array.from({ length: frameCount }, (_entry, index) => {
    const value = rawDelays?.[index];
    return typeof value === 'number' && Number.isFinite(value) && value > 0
      ? Math.max(1, Math.round(value))
      : DEFAULT_DELAY_MS;
  });
  const rawLoop = (metadata as sharp.Metadata & { loop?: number }).loop;
  const loop = typeof rawLoop === 'number' && Number.isFinite(rawLoop) && rawLoop >= 0
    ? Math.round(rawLoop)
    : 0;

  const outputBuffer = frameCount > 1
    ? await cropAnimatedImage(sourceBuffer, crop, quality, frameCount, delays, loop)
    : await cropStillImage(sourceBuffer, crop, quality);

  const names = outputFilename({
    requested: options.filename,
    sourceFilename: download.filename || sourceImage.filename,
    aspectRatio: crop.aspectRatio,
    anchor: crop.anchor,
  });
  const parentId = options.parentId || options.imageId;
  const upload = await uploadCroppedBuffer({
    buffer: outputBuffer,
    filename: names.filename,
    displayName: names.displayName,
    folder: options.folder,
    createFolder: options.createFolder,
    tags: options.tags || sourceImage.tags,
    description:
      options.description
      || `Width-preserving ${crop.aspectRatio} ${crop.anchor}-anchored crop of ${sourceImage.filename || download.filename || options.imageId}.`,
    prompt: options.prompt,
    originalUrl: options.originalUrl || sourceImage.originalUrl || undefined,
    sourceUrl: options.sourceUrl || sourceImage.sourceUrl || undefined,
    namespace: options.namespace || sourceImage.namespace || undefined,
    parentId,
  });

  return {
    ...upload,
    sourceImageId: options.imageId,
    sourceWidth,
    sourceHeight,
    crop,
    ...(frameCount > 1
      ? {
          animated: {
            frameCount,
            delaysPreserved: Array.isArray(rawDelays) && rawDelays.length > 0,
          },
        }
      : {}),
    bytes: outputBuffer.byteLength,
    mimeType: 'image/webp',
    uploadFilename: names.filename,
    displayName: (upload.displayName as string | undefined) || names.displayName,
    parentId,
  };
}
