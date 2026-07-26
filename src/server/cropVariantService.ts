import sharp from 'sharp';
import { fetchCloudflareImage, getCloudflareCredentials } from '@/server/cloudflareClient';
import { fetchOriginalImageBlob } from '@/server/animatedWebpService';
import { uploadImageBuffer } from '@/server/uploadService';
import { patchImageExtrasRecord } from '@/server/imageExtras';
import { parseCloudflareMetadata } from '@/utils/cloudflareMetadata';
import { sanitizeFilename } from '@/utils/filename';

export type CropVariantAnchor = 'top' | 'center' | 'bottom';
export type CropVariantMode = 'crop' | 'outpaint';
export type CropVariantPlacement = 'top' | 'center' | 'bottom' | 'left' | 'right';

export type CropVariantOptions = {
  imageId: string;
  aspectRatio?: string;
  anchor?: CropVariantAnchor;
  mode?: CropVariantMode;
  placement?: CropVariantPlacement;
  quality?: number;
  filename?: string;
  description?: string;
  tags?: string[];
  folder?: string;
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

export type OutpaintCanvasGeometry = {
  sourceWidth: number;
  sourceHeight: number;
  targetWidth: number;
  targetHeight: number;
  aspectRatio: string;
  placement: CropVariantPlacement;
  x: number;
  y: number;
  padding: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
};

export type CropVariantResult = {
  id: string;
  url?: string;
  variants?: string[];
  filename?: string;
  displayName?: string;
  parentId?: string;
  sourceImageId: string;
  sourceWidth: number;
  sourceHeight: number;
  mode: CropVariantMode;
  crop?: CropGeometry;
  canvas?: OutpaintCanvasGeometry;
  animated?: {
    frameCount: number;
    delaysPreserved: boolean;
  };
  bytes: number;
  mimeType: 'image/webp';
  image: unknown;
};

type AspectRatio = {
  label: string;
  width: number;
  height: number;
};

type OutpaintPreparedImage = {
  sourcePng: Buffer;
  maskPng: Buffer;
  canvas: OutpaintCanvasGeometry;
};

type OpenAiImageResult = {
  buffer: Buffer;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  model: string;
  revisedPrompt?: string;
};

const DEFAULT_ASPECT_RATIO = '4:5';
const DEFAULT_QUALITY = 90;
const DEFAULT_DELAY_MS = 1000;
const DEFAULT_OPENAI_IMAGE_MODEL = process.env.PHOTARIUM_OPENAI_IMAGE_MODEL || 'gpt-image-2';
const OPENAI_API_BASE_URL = process.env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MIN_IMAGE_PIXELS = 655_360;
const OPENAI_MAX_IMAGE_PIXELS = 8_294_400;
const OPENAI_MAX_IMAGE_EDGE = 3840;
const OPENAI_IMAGE_EDGE_MULTIPLE = 16;

export function parseCropAspectRatio(value = DEFAULT_ASPECT_RATIO): AspectRatio {
  const trimmed = value.trim();
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(trimmed);
  if (!match) {
    throw new Error('Aspect ratio must use width:height format, for example 4:5');
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Aspect ratio values must be positive numbers');
  }

  return { label: trimmed, width, height };
}

export function normalizeCropAnchor(value?: string): CropVariantAnchor {
  if (value === 'top' || value === 'center' || value === 'bottom') {
    return value;
  }
  return 'bottom';
}

export function normalizeCropQuality(value?: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_QUALITY;
  }
  return Math.max(1, Math.min(100, Math.round(value || DEFAULT_QUALITY)));
}

export function normalizeCropVariantMode(value?: string): CropVariantMode {
  return value === 'outpaint' ? 'outpaint' : 'crop';
}

export function normalizeOutpaintPlacement(value?: string): CropVariantPlacement {
  if (value === 'top' || value === 'center' || value === 'bottom' || value === 'left' || value === 'right') {
    return value;
  }
  return 'center';
}

export function computeWidthPreservingCrop(input: {
  sourceWidth: number;
  sourceHeight: number;
  aspectRatio?: string;
  anchor?: CropVariantAnchor;
}): CropGeometry {
  const ratio = parseCropAspectRatio(input.aspectRatio);
  const sourceWidth = Math.round(input.sourceWidth);
  const sourceHeight = Math.round(input.sourceHeight);
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error('Source image dimensions could not be resolved');
  }

  const targetHeight = Math.round(sourceWidth * ratio.height / ratio.width);
  if (targetHeight > sourceHeight) {
    throw new Error(
      `Requested ${ratio.label} crop needs ${targetHeight}px height, but the source is ${sourceHeight}px tall`
    );
  }

  const anchor = input.anchor ?? 'bottom';
  let y = 0;
  if (anchor === 'center') {
    y = Math.round((sourceHeight - targetHeight) / 2);
  } else if (anchor === 'bottom') {
    y = sourceHeight - targetHeight;
  }

  return {
    width: sourceWidth,
    height: targetHeight,
    aspectRatio: ratio.label,
    anchor,
    x: 0,
    y,
  };
}

function buildCropFilename(
  sourceFilename?: string,
  requestedFilename?: string,
  details?: { aspectRatio: string; placement: string },
  mode: CropVariantMode = 'crop'
) {
  const baseSource = requestedFilename || sourceFilename || 'image';
  const base = sanitizeFilename(baseSource).replace(/\.[^.]+$/, '') || 'image';
  const suffix = details ? `${details.aspectRatio.replace(':', 'x')}-${details.placement}` : mode;
  return sanitizeFilename(`${base}-${mode}-${suffix}.webp`);
}

function normalizeOptionalText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeTags(tags: unknown) {
  if (!Array.isArray(tags)) {
    return undefined;
  }
  const cleaned = tags
    .map((tag) => (typeof tag === 'string' ? tag.trim() : ''))
    .filter(Boolean);
  return cleaned.length ? Array.from(new Set(cleaned)) : undefined;
}

function alignUp(value: number, multiple: number) {
  return Math.ceil(value / multiple) * multiple;
}

function clampOpenAiCanvasSize(canvas: { width: number; height: number }) {
  if (canvas.width > OPENAI_MAX_IMAGE_EDGE || canvas.height > OPENAI_MAX_IMAGE_EDGE) {
    throw new Error(`Expanded canvas must fit within ${OPENAI_MAX_IMAGE_EDGE}px per edge for OpenAI image edits`);
  }
  const pixels = canvas.width * canvas.height;
  if (pixels > OPENAI_MAX_IMAGE_PIXELS) {
    throw new Error(`Expanded canvas is ${pixels.toLocaleString()} pixels, above the OpenAI image edit limit`);
  }
  if (pixels < OPENAI_MIN_IMAGE_PIXELS) {
    throw new Error('Expanded canvas is too small for OpenAI image edits');
  }
}

export function computeOutpaintCanvas(input: {
  sourceWidth: number;
  sourceHeight: number;
  aspectRatio?: string;
  placement?: CropVariantPlacement;
}): OutpaintCanvasGeometry {
  const ratio = parseCropAspectRatio(input.aspectRatio);
  const sourceWidth = Math.round(input.sourceWidth);
  const sourceHeight = Math.round(input.sourceHeight);
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error('Source image dimensions could not be resolved');
  }

  const targetRatio = ratio.width / ratio.height;
  const sourceRatio = sourceWidth / sourceHeight;
  let targetWidth = sourceWidth;
  let targetHeight = sourceHeight;
  if (sourceRatio < targetRatio) {
    targetWidth = Math.ceil(sourceHeight * targetRatio);
  } else if (sourceRatio > targetRatio) {
    targetHeight = Math.ceil(sourceWidth / targetRatio);
  }

  targetWidth = alignUp(targetWidth, OPENAI_IMAGE_EDGE_MULTIPLE);
  targetHeight = alignUp(targetHeight, OPENAI_IMAGE_EDGE_MULTIPLE);
  clampOpenAiCanvasSize({ width: targetWidth, height: targetHeight });

  const placement = input.placement ?? 'center';
  const extraX = targetWidth - sourceWidth;
  const extraY = targetHeight - sourceHeight;
  const x = placement === 'left' ? 0 : placement === 'right' ? extraX : Math.round(extraX / 2);
  const y = placement === 'top' ? 0 : placement === 'bottom' ? extraY : Math.round(extraY / 2);

  return {
    sourceWidth,
    sourceHeight,
    targetWidth,
    targetHeight,
    aspectRatio: ratio.label,
    placement,
    x,
    y,
    padding: {
      top: y,
      right: targetWidth - sourceWidth - x,
      bottom: targetHeight - sourceHeight - y,
      left: x,
    },
  };
}

function buildOutpaintPrompt(canvas: OutpaintCanvasGeometry, additionalPrompt?: string) {
  return [
    'Expand this image to fill the transparent canvas while preserving the original image exactly.',
    'Only generate visual content in the transparent outer area.',
    'Continue the scene naturally with matching lighting, perspective, texture, color, depth of field, and photographic style.',
    `Target aspect ratio: ${canvas.aspectRatio}. Original image placement: ${canvas.placement}.`,
    ...(additionalPrompt?.trim() ? [`Additional instructions: ${additionalPrompt.trim()}`] : []),
  ].join(' ');
}

function readOpenAiApiKey() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required for AI expand crop variants');
  }
  return apiKey;
}

export async function prepareOutpaintEditImage(input: {
  buffer: Buffer;
  aspectRatio?: string;
  placement?: CropVariantPlacement;
}): Promise<OutpaintPreparedImage> {
  const sourcePng = await sharp(input.buffer, { animated: false, failOn: 'none' })
    .ensureAlpha()
    .png()
    .toBuffer();
  const metadata = await sharp(sourcePng, { failOn: 'none' }).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error('Source image dimensions could not be resolved');
  }
  const canvas = computeOutpaintCanvas({
    sourceWidth: metadata.width,
    sourceHeight: metadata.height,
    aspectRatio: input.aspectRatio,
    placement: input.placement,
  });

  const base = await sharp({
    create: {
      width: canvas.targetWidth,
      height: canvas.targetHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: sourcePng, left: canvas.x, top: canvas.y }])
    .png()
    .toBuffer();

  // OpenAI preserves opaque mask pixels and edits transparent pixels. Keep the
  // source image opaque so the expansion is limited to the added canvas area.
  const maskRaw = Buffer.alloc(canvas.targetWidth * canvas.targetHeight * 4, 0);
  for (let row = canvas.y; row < canvas.y + canvas.sourceHeight; row += 1) {
    for (let column = canvas.x; column < canvas.x + canvas.sourceWidth; column += 1) {
      maskRaw[(row * canvas.targetWidth + column) * 4 + 3] = 255;
    }
  }
  const maskPng = await sharp(maskRaw, {
    raw: {
      width: canvas.targetWidth,
      height: canvas.targetHeight,
      channels: 4,
    },
  })
    .png()
    .toBuffer();

  return {
    sourcePng: base,
    maskPng,
    canvas,
  };
}

async function callOpenAiOutpaintEdit(prepared: OutpaintPreparedImage, additionalPrompt?: string): Promise<OpenAiImageResult> {
  const formData = new FormData();
  const model = DEFAULT_OPENAI_IMAGE_MODEL;
  formData.append('model', model);
  formData.append('prompt', buildOutpaintPrompt(prepared.canvas, additionalPrompt));
  formData.append('size', `${prepared.canvas.targetWidth}x${prepared.canvas.targetHeight}`);
  formData.append('quality', 'high');
  formData.append('output_format', 'webp');
  formData.append('image[]', new Blob([new Uint8Array(prepared.sourcePng)], { type: 'image/png' }), 'source-canvas.png');
  formData.append('mask', new Blob([new Uint8Array(prepared.maskPng)], { type: 'image/png' }), 'mask.png');

  const endpoint = new URL('/v1/images/edits', `${OPENAI_API_BASE_URL.replace(/\/$/, '')}/`);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${readOpenAiApiKey()}`,
    },
    body: formData,
  });
  const rawText = await response.text();
  let parsed: unknown = rawText;
  try {
    parsed = rawText ? JSON.parse(rawText) : {};
  } catch {
    parsed = rawText;
  }
  if (!response.ok) {
    throw new Error(`OpenAI image edit failed (${response.status}): ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`);
  }
  const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  const data = Array.isArray(record.data) ? record.data : [];
  const first = data.find((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item));
  const b64Json = typeof first?.b64_json === 'string' ? first.b64_json : undefined;
  const revisedPrompt = typeof first?.revised_prompt === 'string' ? first.revised_prompt : undefined;
  if (!b64Json) {
    throw new Error('OpenAI image edit returned no image data');
  }
  return {
    buffer: Buffer.from(b64Json, 'base64'),
    mimeType: 'image/webp',
    model,
    revisedPrompt,
  };
}

export async function outpaintImageToWebp(input: {
  buffer: Buffer;
  aspectRatio?: string;
  placement?: CropVariantPlacement;
  prompt?: string;
}) {
  const prepared = await prepareOutpaintEditImage(input);
  const generated = await callOpenAiOutpaintEdit(prepared, input.prompt);
  return {
    buffer: generated.buffer,
    sourceWidth: prepared.canvas.sourceWidth,
    sourceHeight: prepared.canvas.sourceHeight,
    canvas: prepared.canvas,
    model: generated.model,
    revisedPrompt: generated.revisedPrompt,
  };
}

async function cropAnimatedWebp(input: {
  buffer: Buffer;
  width: number;
  pageHeight: number;
  frameCount: number;
  crop: CropGeometry;
  metadata: sharp.Metadata;
  quality: number;
}) {
  const raw = await sharp(input.buffer, { animated: true }).ensureAlpha().raw().toBuffer();
  const sourceFrameSize = input.width * input.pageHeight * 4;
  if (raw.byteLength < sourceFrameSize * input.frameCount) {
    throw new Error('Animated image frame data is incomplete');
  }

  const targetFrameSize = input.crop.width * input.crop.height * 4;
  const croppedFrames = Array.from({ length: input.frameCount }, (_frame, frameIndex) => {
    const frameStart = frameIndex * sourceFrameSize;
    const target = Buffer.allocUnsafe(targetFrameSize);
    for (let row = 0; row < input.crop.height; row += 1) {
      const sourceStart = frameStart + ((input.crop.y + row) * input.width + input.crop.x) * 4;
      const sourceEnd = sourceStart + input.crop.width * 4;
      raw.copy(target, row * input.crop.width * 4, sourceStart, sourceEnd);
    }
    return target;
  });

  const delay = Array.isArray(input.metadata.delay) && input.metadata.delay.length
    ? input.metadata.delay.map((value) => (Number.isFinite(value) && value > 0 ? Math.round(value) : DEFAULT_DELAY_MS))
    : Array(input.frameCount).fill(DEFAULT_DELAY_MS);
  const loop = Number.isFinite(input.metadata.loop) ? input.metadata.loop : 0;
  const stacked = Buffer.concat(croppedFrames);
  const output = await sharp(stacked, {
    raw: {
      width: input.crop.width,
      height: input.crop.height * input.frameCount,
      channels: 4,
      pageHeight: input.crop.height,
    },
  })
    .webp({
      quality: input.quality,
      effort: 4,
      loop,
      delay,
    })
    .toBuffer();

  return {
    buffer: output,
    frameCount: input.frameCount,
    delaysPreserved: Array.isArray(input.metadata.delay) && input.metadata.delay.length === input.frameCount,
  };
}

export async function cropImageToWebp(input: {
  buffer: Buffer;
  aspectRatio?: string;
  anchor?: CropVariantAnchor;
  quality?: number;
}) {
  const metadata = await sharp(input.buffer, { animated: true, failOn: 'none' }).metadata();
  const width = metadata.width;
  const sourceHeight = metadata.pageHeight || metadata.height;
  if (!width || !sourceHeight) {
    throw new Error('Source image dimensions could not be resolved');
  }

  const crop = computeWidthPreservingCrop({
    sourceWidth: width,
    sourceHeight,
    aspectRatio: input.aspectRatio,
    anchor: input.anchor,
  });
  const quality = normalizeCropQuality(input.quality);
  const frameCount = Math.max(1, Math.round(metadata.pages ?? 1));
  const isAnimated = frameCount > 1;

  if (isAnimated) {
    const animated = await cropAnimatedWebp({
      buffer: input.buffer,
      width,
      pageHeight: sourceHeight,
      frameCount,
      crop,
      metadata,
      quality,
    });
    return {
      buffer: animated.buffer,
      sourceWidth: width,
      sourceHeight,
      crop,
      animated: {
        frameCount: animated.frameCount,
        delaysPreserved: animated.delaysPreserved,
      },
    };
  }

  const output = await sharp(input.buffer, { failOn: 'none' })
    .extract({
      left: crop.x,
      top: crop.y,
      width: crop.width,
      height: crop.height,
    })
    .webp({ quality, effort: 4 })
    .toBuffer();

  return {
    buffer: output,
    sourceWidth: width,
    sourceHeight,
    crop,
    animated: undefined,
  };
}

export async function createCropVariant(options: CropVariantOptions): Promise<CropVariantResult> {
  if (!options.imageId) {
    throw new Error('Image ID is required');
  }

  const credentials = getCloudflareCredentials();
  const sourceImage = await fetchCloudflareImage(options.imageId, credentials);
  const sourceMeta = parseCloudflareMetadata(sourceImage.meta);
  // SVG sources have no raster pixels to crop. Crop the linked WebP variant
  // instead (it was rasterized on upload); fall back to the SVG id only for
  // legacy uploads without a variant, where sharp rasterizes it on the fly.
  const sourceIsSvg =
    (sourceImage.filename?.toLowerCase().endsWith('.svg') ?? false) ||
    sourceMeta.type === 'image/svg+xml';
  const cropSourceId = sourceIsSvg && sourceMeta.linkedAssetId
    ? sourceMeta.linkedAssetId
    : options.imageId;
  const { buffer: originalBuffer } = await fetchOriginalImageBlob(cropSourceId);
  const anchor = normalizeCropAnchor(options.anchor);
  const mode = normalizeCropVariantMode(options.mode);
  const result = mode === 'outpaint'
    ? await outpaintImageToWebp({
      buffer: originalBuffer,
      aspectRatio: options.aspectRatio,
      placement: normalizeOutpaintPlacement(options.placement),
    })
    : await cropImageToWebp({
      buffer: originalBuffer,
      aspectRatio: options.aspectRatio,
      anchor,
      quality: options.quality,
    });

  const details = 'crop' in result
    ? { aspectRatio: result.crop.aspectRatio, placement: result.crop.anchor }
    : { aspectRatio: result.canvas.aspectRatio, placement: result.canvas.placement };
  const filename = buildCropFilename(sourceImage.filename, options.filename, details, mode);
  const inheritedTags = Array.isArray(sourceMeta.tags) ? sourceMeta.tags : [];
  const requestedTags = normalizeTags(options.tags);
  const tags = requestedTags ?? inheritedTags;
  const upload = await uploadImageBuffer({
    buffer: result.buffer,
    originalBuffer: result.buffer,
    fileName: filename,
    fileType: 'image/webp',
    fileSize: result.buffer.byteLength,
    context: {
      accountId: credentials.accountId,
      apiToken: credentials.apiToken,
      folder: normalizeOptionalText(options.folder) ?? sourceMeta.folder,
      tags,
      description: normalizeOptionalText(options.description) ?? sourceMeta.description,
      originalUrl: sourceMeta.originalUrl,
      sourceUrl: sourceMeta.sourceUrl,
      sourcePath: sourceMeta.sourcePath,
      namespace: normalizeOptionalText(options.namespace) ?? sourceMeta.namespace,
      parentId: normalizeOptionalText(options.parentId) ?? options.imageId,
      generatedBy: mode === 'outpaint' ? 'openai' : undefined,
    },
  });

  if (!upload.ok) {
    const error = new Error(upload.error);
    Object.assign(error, { status: upload.status });
    throw error;
  }

  if (mode === 'outpaint' && 'canvas' in result) {
    await patchImageExtrasRecord(upload.data.id, {
      imageToolRun: {
        toolId: 'crop-outpaint',
        adapterKind: 'openai-image-edit',
        sourceImageId: options.imageId,
        params: {
          aspectRatio: result.canvas.aspectRatio,
          placement: result.canvas.placement,
          model: result.model,
          revisedPrompt: result.revisedPrompt,
        },
        output: {
          width: result.canvas.targetWidth,
          height: result.canvas.targetHeight,
          mimeType: 'image/webp',
        },
        createdAt: new Date().toISOString(),
      },
    });
  }

  return {
    id: upload.data.id,
    url: upload.data.url,
    variants: upload.data.variants,
    filename: upload.data.filename,
    displayName: upload.data.filename,
    parentId: upload.data.parentId,
    sourceImageId: options.imageId,
    sourceWidth: result.sourceWidth,
    sourceHeight: result.sourceHeight,
    mode,
    ...('crop' in result ? { crop: result.crop, animated: result.animated } : { canvas: result.canvas }),
    bytes: result.buffer.byteLength,
    mimeType: 'image/webp',
    image: upload.data,
  };
}
