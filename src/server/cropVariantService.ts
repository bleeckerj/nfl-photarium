import sharp from 'sharp';
import { fetchCloudflareImage, getCloudflareCredentials } from '@/server/cloudflareClient';
import { fetchOriginalImageBlob } from '@/server/animatedWebpService';
import { uploadImageBuffer } from '@/server/uploadService';
import { parseCloudflareMetadata } from '@/utils/cloudflareMetadata';
import { sanitizeFilename } from '@/utils/filename';

export type CropVariantAnchor = 'top' | 'center' | 'bottom';

export type CropVariantOptions = {
  imageId: string;
  aspectRatio?: string;
  anchor?: CropVariantAnchor;
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
  crop: CropGeometry;
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

const DEFAULT_ASPECT_RATIO = '4:5';
const DEFAULT_QUALITY = 90;
const DEFAULT_DELAY_MS = 1000;

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

function buildCropFilename(sourceFilename?: string, requestedFilename?: string, crop?: CropGeometry) {
  const baseSource = requestedFilename || sourceFilename || 'image';
  const base = sanitizeFilename(baseSource).replace(/\.[^.]+$/, '') || 'image';
  const suffix = crop ? `${crop.aspectRatio.replace(':', 'x')}-${crop.anchor}` : 'crop';
  return sanitizeFilename(`${base}-crop-${suffix}.webp`);
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
  const cropped = await cropImageToWebp({
    buffer: originalBuffer,
    aspectRatio: options.aspectRatio,
    anchor,
    quality: options.quality,
  });

  const filename = buildCropFilename(sourceImage.filename, options.filename, cropped.crop);
  const inheritedTags = Array.isArray(sourceMeta.tags) ? sourceMeta.tags : [];
  const requestedTags = normalizeTags(options.tags);
  const tags = requestedTags ?? inheritedTags;
  const upload = await uploadImageBuffer({
    buffer: cropped.buffer,
    originalBuffer: cropped.buffer,
    fileName: filename,
    fileType: 'image/webp',
    fileSize: cropped.buffer.byteLength,
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
    },
  });

  if (!upload.ok) {
    const error = new Error(upload.error);
    Object.assign(error, { status: upload.status });
    throw error;
  }

  return {
    id: upload.data.id,
    url: upload.data.url,
    variants: upload.data.variants,
    filename: upload.data.filename,
    displayName: upload.data.filename,
    parentId: upload.data.parentId,
    sourceImageId: options.imageId,
    sourceWidth: cropped.sourceWidth,
    sourceHeight: cropped.sourceHeight,
    crop: cropped.crop,
    animated: cropped.animated,
    bytes: cropped.buffer.byteLength,
    mimeType: 'image/webp',
    image: upload.data,
  };
}
