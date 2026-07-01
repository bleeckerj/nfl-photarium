import sharp from 'sharp';
import { sanitizeSvgBuffer } from '@/server/svgSanitizer';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const CLOUDFLARE_MAX_IMAGE_DIMENSION = 12_000;
export const CLOUDFLARE_MAX_IMAGE_AREA = 100_000_000;
export const CLOUDFLARE_MAX_ANIMATION_FRAME_AREA = 100_000_000;

const SHARP_DEFAULT_INPUT_PIXEL_LIMIT = 0x3fff ** 2;
const MAX_UPLOAD_NORMALIZATION_INPUT_PIXELS = 1_000_000_000;

export type PreparedUploadPayload = {
  buffer: Buffer;
  fileType: string;
  fileName: string;
  transformed: boolean;
  bytesBefore: number;
  bytesAfter: number;
  note?: string;
  uploadNormalization?: UploadNormalizationMetadata;
};

export type UploadNormalizationReason = 'max-bytes' | 'max-dimension' | 'max-area' | 'max-frame-area';

export type UploadNormalizationMetadata = {
  reasons: UploadNormalizationReason[];
  originalBytes: number;
  finalBytes: number;
  maxBytes: number;
  maxDimension: number;
  maxArea: number;
  maxAnimationFrameArea: number;
  originalType: string;
  finalType: string;
  originalWidth?: number;
  originalHeight?: number;
  originalFrameCount?: number;
  originalFrameArea?: number;
  finalWidth?: number;
  finalHeight?: number;
  finalFrameCount?: number;
  finalFrameArea?: number;
};

const IMAGE_EXTENSION_BY_TYPE: Record<string, string> = {
  'image/webp': '.webp',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'image/avif': '.avif',
};

const CLOUDFLARE_NATIVE_UPLOAD_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
]);

const normalizeUploadMimeType = (fileType: string) => {
  const normalized = fileType.trim().toLowerCase();
  return normalized === 'image/jpg' ? 'image/jpeg' : normalized;
};

const withExtensionForType = (fileName: string, fileType: string) => {
  const ext = IMAGE_EXTENSION_BY_TYPE[fileType];
  if (!ext) return fileName;
  if (fileName.toLowerCase().endsWith(ext)) return fileName;
  if (/\.[a-z0-9]+$/i.test(fileName)) {
    return fileName.replace(/\.[^.]+$/, ext);
  }
  return `${fileName}${ext}`;
};

const evaluateConstraintReasons = ({
  bytes,
  width,
  height,
  maxBytes,
  maxDimension,
  maxArea,
  maxAnimationFrameArea = maxArea,
  frameCount = 1,
}: {
  bytes: number;
  width?: number;
  height?: number;
  maxBytes: number;
  maxDimension: number;
  maxArea: number;
  maxAnimationFrameArea?: number;
  frameCount?: number;
}): UploadNormalizationReason[] => {
  const reasons: UploadNormalizationReason[] = [];
  if (bytes > maxBytes) {
    reasons.push('max-bytes');
  }
  if (typeof width === 'number' && typeof height === 'number') {
    if (width > maxDimension || height > maxDimension) {
      reasons.push('max-dimension');
    }
    if (width * height > maxArea) {
      reasons.push('max-area');
    }
    if (frameCount > 1 && width * height * frameCount > maxAnimationFrameArea) {
      reasons.push('max-frame-area');
    }
  }
  return reasons;
};

const describeReasons = (reasons: UploadNormalizationReason[]): string => {
  const labels = reasons.map((reason) => {
    if (reason === 'max-bytes') return 'byte limit';
    if (reason === 'max-dimension') return 'dimension limit';
    if (reason === 'max-frame-area') return 'animation frame-area limit';
    return 'pixel-area limit';
  });
  return labels.join(', ');
};

const resolveFitInsideDimensions = (
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number
) => {
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight, 1);
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
};

export const resolveUploadNormalizationDecodeLimit = (inputPixelArea: number): number | null | undefined => {
  if (!Number.isFinite(inputPixelArea) || inputPixelArea <= 0) {
    return undefined;
  }
  if (inputPixelArea <= SHARP_DEFAULT_INPUT_PIXEL_LIMIT) {
    return undefined;
  }
  if (inputPixelArea > MAX_UPLOAD_NORMALIZATION_INPUT_PIXELS) {
    return null;
  }
  return Math.ceil(inputPixelArea);
};

const buildSharpInputOptions = ({
  animated,
  decodeLimit,
}: {
  animated: boolean;
  decodeLimit: number | null | undefined;
}): sharp.SharpOptions => {
  const options: sharp.SharpOptions = animated ? { animated: true } : {};
  if (typeof decodeLimit === 'number') {
    options.limitInputPixels = decodeLimit;
  }
  return options;
};

const describeEncodeError = (error: unknown) =>
  error instanceof Error ? error.message : 'unknown conversion error';

const probeEncodedMetrics = async ({
  buffer,
  animated,
  fallbackWidth,
  fallbackHeight,
  fallbackFrameCount,
}: {
  buffer: Buffer;
  animated: boolean;
  fallbackWidth?: number;
  fallbackHeight?: number;
  fallbackFrameCount: number;
}) => {
  if (!animated) {
    return {
      width: fallbackWidth,
      height: fallbackHeight,
      frameCount: fallbackFrameCount,
    };
  }

  try {
    const metadata = await sharp(buffer, { animated: true }).metadata();
    const width = typeof metadata.width === 'number' ? metadata.width : fallbackWidth;
    const height =
      typeof metadata.pageHeight === 'number' && metadata.pageHeight > 0
        ? metadata.pageHeight
        : (fallbackHeight ?? (typeof metadata.height === 'number' ? metadata.height : undefined));
    return {
      width,
      height,
      frameCount: Math.max(1, Math.round(metadata.pages ?? fallbackFrameCount)),
    };
  } catch {
    return {
      width: fallbackWidth,
      height: fallbackHeight,
      frameCount: fallbackFrameCount,
    };
  }
};

export async function prepareImageForUpload({
  buffer,
  fileType,
  fileName,
  maxBytes = MAX_IMAGE_BYTES,
}: {
  buffer: Buffer;
  fileType: string;
  fileName: string;
  maxBytes?: number;
}): Promise<{ ok: true; data: PreparedUploadPayload } | { ok: false; error: string }> {
  const bytesBefore = buffer.byteLength;
  const normalizedFileType = normalizeUploadMimeType(fileType);

  if (!normalizedFileType.startsWith('image/')) {
    return { ok: false, error: 'File must be an image' };
  }

  // SVG is vector XML, not raster pixels. Sanitize it and store the cleaned
  // original as-is; never run it through the raster transcode pipeline below.
  if (normalizedFileType === 'image/svg+xml') {
    const sanitized = sanitizeSvgBuffer(buffer);
    if (!sanitized.ok) {
      return { ok: false, error: sanitized.error };
    }
    if (sanitized.buffer.byteLength > maxBytes) {
      return {
        ok: false,
        error: `SVG exceeds the maximum upload size of ${(maxBytes / 1024 / 1024).toFixed(0)}MB.`,
      };
    }
    return {
      ok: true,
      data: {
        buffer: sanitized.buffer,
        fileType: normalizedFileType,
        fileName,
        transformed: sanitized.modified,
        bytesBefore,
        bytesAfter: sanitized.buffer.byteLength,
        note: sanitized.modified ? 'Sanitized SVG (removed potentially unsafe content)' : undefined,
      },
    };
  }

  let metadata: sharp.Metadata | undefined;
  try {
    metadata = await sharp(buffer).metadata();
  } catch {
    metadata = undefined;
  }

  const preliminaryFrameCount = Math.max(1, Math.round(metadata?.pages ?? 1));
  const preliminaryWidth = typeof metadata?.width === 'number' ? metadata.width : 0;
  const preliminaryFrameHeight =
    typeof metadata?.pageHeight === 'number' && metadata.pageHeight > 0
      ? metadata.pageHeight
      : (typeof metadata?.height === 'number' ? metadata.height : 0);
  const preliminaryAnimatedPixels = preliminaryFrameCount > 1 && preliminaryWidth && preliminaryFrameHeight
    ? preliminaryWidth * preliminaryFrameHeight * preliminaryFrameCount
    : 0;
  const preliminaryAnimatedDecodeLimit = resolveUploadNormalizationDecodeLimit(preliminaryAnimatedPixels);

  let animatedMetadata: sharp.Metadata | undefined;
  if (preliminaryFrameCount > 1 && preliminaryAnimatedDecodeLimit !== null) {
    try {
      animatedMetadata = await sharp(
        buffer,
        buildSharpInputOptions({ animated: true, decodeLimit: preliminaryAnimatedDecodeLimit })
      ).metadata();
    } catch {
      animatedMetadata = undefined;
    }
  }

  const sourceFrameCount = Math.max(1, Math.round(metadata?.pages ?? animatedMetadata?.pages ?? 1));
  const isAnimated = sourceFrameCount > 1;
  const activeMetadata = animatedMetadata ?? metadata;
  const sourceWidth = typeof activeMetadata?.width === 'number' ? activeMetadata.width : 0;
  const animatedPageHeight =
    typeof animatedMetadata?.pageHeight === 'number' && animatedMetadata.pageHeight > 0
      ? animatedMetadata.pageHeight
      : undefined;
  const sourceHeight = isAnimated
    ? (animatedPageHeight ?? (typeof metadata?.height === 'number' ? metadata.height : 0))
    : (typeof metadata?.height === 'number' ? metadata.height : 0);
  const canResize = Boolean(sourceWidth && sourceHeight);
  const sourceReasons = evaluateConstraintReasons({
    bytes: bytesBefore,
    width: canResize ? sourceWidth : undefined,
    height: canResize ? sourceHeight : undefined,
    maxBytes,
    maxDimension: CLOUDFLARE_MAX_IMAGE_DIMENSION,
    maxArea: CLOUDFLARE_MAX_IMAGE_AREA,
    maxAnimationFrameArea: CLOUDFLARE_MAX_ANIMATION_FRAME_AREA,
    frameCount: sourceFrameCount,
  });
  const requiresCompatibilityTranscode = !CLOUDFLARE_NATIVE_UPLOAD_TYPES.has(normalizedFileType);

  if (sourceReasons.length === 0 && !requiresCompatibilityTranscode) {
    return {
      ok: true,
      data: {
        buffer,
        fileType: normalizedFileType,
        fileName,
        transformed: false,
        bytesBefore,
        bytesAfter: bytesBefore,
      },
    };
  }

  if (!canResize && sourceReasons.some((reason) => reason !== 'max-bytes')) {
    return { ok: false, error: 'Unable to determine image dimensions for Cloudflare upload limits.' };
  }

  const qualitySteps = [92, 88, 84, 80, 76, 72, 68, 64, 60];
  const sourceArea = canResize ? sourceWidth * sourceHeight : 0;
  const sourceFrameArea = sourceArea * sourceFrameCount;
  const scaleToRespectDimension = canResize
    ? Math.min(1, CLOUDFLARE_MAX_IMAGE_DIMENSION / Math.max(sourceWidth, sourceHeight))
    : 1;
  const scaleToRespectArea = canResize && sourceArea > 0
    ? Math.min(1, Math.sqrt(CLOUDFLARE_MAX_IMAGE_AREA / sourceArea))
    : 1;
  const scaleToRespectAnimationFrameArea = canResize && sourceFrameCount > 1 && sourceFrameArea > 0
    ? Math.min(1, Math.sqrt(CLOUDFLARE_MAX_ANIMATION_FRAME_AREA / sourceFrameArea))
    : 1;
  const requiredScale = Math.min(1, scaleToRespectDimension, scaleToRespectArea, scaleToRespectAnimationFrameArea);
  const rawScaleSteps = canResize
    ? Array.from(new Set([
        1,
        0.96,
        0.92,
        0.88,
        0.84,
        0.8,
        0.75,
        0.7,
        0.65,
        0.6,
        0.55,
        0.5,
        0.45,
        0.4,
        0.35,
        0.3,
        Number(requiredScale.toFixed(4)),
        Number((requiredScale * 0.98).toFixed(4)),
      ].filter((scale) => scale > 0 && scale <= 1))).sort((a, b) => b - a)
    : [1];
  const requiresDimensionOrAreaDownscale =
    sourceReasons.includes('max-dimension') ||
    sourceReasons.includes('max-area') ||
    sourceReasons.includes('max-frame-area');
  const normalizationInputPixels = canResize ? Math.ceil(isAnimated ? sourceFrameArea : sourceArea) : 0;
  const normalizationDecodeLimit = resolveUploadNormalizationDecodeLimit(normalizationInputPixels);
  if (requiresDimensionOrAreaDownscale && normalizationDecodeLimit === null) {
    return {
      ok: false,
      error:
        `Image is too large to normalize safely (${normalizationInputPixels.toLocaleString()} decoded pixels). ` +
        `Upload a smaller derivative or store the original outside Cloudflare Images.`,
    };
  }
  const sharpInputOptions = buildSharpInputOptions({
    animated: isAnimated,
    decodeLimit: normalizationDecodeLimit,
  });
  const scaleSteps = requiresDimensionOrAreaDownscale
    ? rawScaleSteps.filter((scale) => scale <= requiredScale + 0.0005)
    : rawScaleSteps;
  const minDimension = 320;
  const minResizeDimension = requiresDimensionOrAreaDownscale ? 1 : minDimension;
  const formatOrder = isAnimated ? ['image/webp'] : ['image/webp', 'image/jpeg'];

  let smallestCandidate:
    | {
        buffer: Buffer;
        type: string;
        quality: number;
        width?: number;
        height?: number;
        frameCount: number;
        reasons: UploadNormalizationReason[];
      }
    | null = null;
  let lastEncodeError: unknown;

  for (const scale of scaleSteps) {
    const requestedWidth = canResize ? Math.max(minResizeDimension, Math.round(sourceWidth * scale)) : 0;
    const requestedHeight = canResize ? Math.max(minResizeDimension, Math.round(sourceHeight * scale)) : 0;
    const needsResize = canResize && (requestedWidth !== sourceWidth || requestedHeight !== sourceHeight);
    const resizedDimensions = canResize
      ? (needsResize
          ? resolveFitInsideDimensions(sourceWidth, sourceHeight, requestedWidth, requestedHeight)
          : { width: sourceWidth, height: sourceHeight })
      : undefined;

    for (const quality of qualitySteps) {
      const passing: Array<{
        buffer: Buffer;
        type: string;
        width?: number;
        height?: number;
        frameCount: number;
      }> = [];
      for (const nextType of formatOrder) {
        let pipeline = isAnimated ? sharp(buffer, sharpInputOptions) : sharp(buffer, sharpInputOptions).rotate();
        if (canResize && needsResize) {
          pipeline = pipeline.resize(requestedWidth, requestedHeight, {
            fit: 'inside',
            withoutEnlargement: true,
          });
        }

        let encoded: Buffer;
        try {
          encoded =
            nextType === 'image/webp'
              ? await pipeline.webp({ quality, effort: 4 }).toBuffer()
              : await pipeline
                  .flatten({ background: '#ffffff' })
                  .jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:4:4' })
                  .toBuffer();
        } catch (error) {
          lastEncodeError = error;
          continue;
        }

        const encodedMetrics = await probeEncodedMetrics({
          buffer: encoded,
          animated: isAnimated,
          fallbackWidth: resizedDimensions?.width,
          fallbackHeight: resizedDimensions?.height,
          fallbackFrameCount: sourceFrameCount,
        });

        const encodedReasons = evaluateConstraintReasons({
          bytes: encoded.byteLength,
          width: encodedMetrics.width,
          height: encodedMetrics.height,
          maxBytes,
          maxDimension: CLOUDFLARE_MAX_IMAGE_DIMENSION,
          maxArea: CLOUDFLARE_MAX_IMAGE_AREA,
          maxAnimationFrameArea: CLOUDFLARE_MAX_ANIMATION_FRAME_AREA,
          frameCount: encodedMetrics.frameCount,
        });

        if (!smallestCandidate || encoded.byteLength < smallestCandidate.buffer.byteLength) {
          smallestCandidate = {
            buffer: encoded,
            type: nextType,
            quality,
            width: encodedMetrics.width,
            height: encodedMetrics.height,
            frameCount: encodedMetrics.frameCount,
            reasons: encodedReasons,
          };
        }

        if (encodedReasons.length === 0) {
          passing.push({
            buffer: encoded,
            type: nextType,
            width: encodedMetrics.width,
            height: encodedMetrics.height,
            frameCount: encodedMetrics.frameCount,
          });
        }
      }

      if (passing.length > 0) {
        const chosen = passing.sort((a, b) => b.buffer.byteLength - a.buffer.byteLength)[0];
        const notePrefix = sourceReasons.length
          ? `Adjusted for ${describeReasons(sourceReasons)}`
          : 'Converted for Cloudflare upload compatibility';
        const note = canResize && chosen.width && chosen.height && needsResize
          ? `${notePrefix}: converted to ${chosen.type === 'image/webp' ? 'WebP' : 'JPEG'} and resized to ${chosen.width}x${chosen.height} (q${quality})`
          : `${notePrefix}: converted to ${chosen.type === 'image/webp' ? 'WebP' : 'JPEG'} (q${quality})`;
        return {
          ok: true,
          data: {
            buffer: chosen.buffer,
            fileType: chosen.type,
            fileName: withExtensionForType(fileName, chosen.type),
            transformed: true,
            bytesBefore,
            bytesAfter: chosen.buffer.byteLength,
            note,
            uploadNormalization: {
              reasons: sourceReasons,
              originalBytes: bytesBefore,
              finalBytes: chosen.buffer.byteLength,
              maxBytes,
              maxDimension: CLOUDFLARE_MAX_IMAGE_DIMENSION,
              maxArea: CLOUDFLARE_MAX_IMAGE_AREA,
              maxAnimationFrameArea: CLOUDFLARE_MAX_ANIMATION_FRAME_AREA,
              originalType: fileType,
              finalType: chosen.type,
              originalWidth: canResize ? sourceWidth : undefined,
              originalHeight: canResize ? sourceHeight : undefined,
              originalFrameCount: isAnimated ? sourceFrameCount : undefined,
              originalFrameArea: isAnimated && canResize ? sourceFrameArea : undefined,
              finalWidth: chosen.width,
              finalHeight: chosen.height,
              finalFrameCount: isAnimated ? chosen.frameCount : undefined,
              finalFrameArea: isAnimated && chosen.width && chosen.height
                ? chosen.width * chosen.height * chosen.frameCount
                : undefined,
            },
          },
        };
      }
    }
  }

  if (smallestCandidate) {
    const unsatisfied = smallestCandidate.reasons.length
      ? ` Remaining issues: ${describeReasons(smallestCandidate.reasons)}.`
      : '';
    return {
      ok: false,
      error: `Unable to satisfy upload limits (smallest attempt: ${(smallestCandidate.buffer.byteLength / 1024 / 1024).toFixed(2)}MB).${unsatisfied}`,
    };
  }

  if (lastEncodeError) {
    return {
      ok: false,
      error: `Unable to convert image for upload: ${describeEncodeError(lastEncodeError)}`,
    };
  }

  return { ok: false, error: 'Unable to convert image for upload' };
}
