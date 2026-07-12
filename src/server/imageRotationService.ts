import sharp, { type FormatEnum } from 'sharp';
import { fetchCloudflareImage, getCloudflareCredentials } from '@/server/cloudflareClient';
import { fetchOriginalImageBlob } from '@/server/animatedWebpService';
import { getImageExtrasRecord } from '@/server/imageExtras';
import { uploadImageBuffer } from '@/server/uploadService';
import { parseCloudflareMetadata } from '@/utils/cloudflareMetadata';
import { sanitizeFilename } from '@/utils/filename';

export type QuarterTurn = 90 | 180 | 270;

export type RotatedImageBuffer = {
  buffer: Buffer;
  contentType: string;
  extension: string;
  width: number;
  height: number;
  animated: boolean;
  frameCount: number;
  delaysPreserved: boolean;
  loop?: number;
};

export type ImageRotationResult = RotatedImageBuffer & {
  id: string;
  filename: string;
  url: string;
  variants: string[];
  parentId?: string;
  rotatedFromId: string;
  rotatedAt: string;
  rotationDegrees: QuarterTurn;
};

type CloudflareImageForRotation = Awaited<ReturnType<typeof fetchCloudflareImage>>;

type RotationSource = {
  buffer: Buffer;
  contentType?: string;
  frameCount: number;
  source: 'original-blob' | 'delivery-variant';
};

const DEFAULT_DELAY_MS = 1000;

const FORMAT_TO_OUTPUT: Partial<Record<keyof FormatEnum, { contentType: string; extension: string }>> = {
  jpeg: { contentType: 'image/jpeg', extension: 'jpg' },
  png: { contentType: 'image/png', extension: 'png' },
  webp: { contentType: 'image/webp', extension: 'webp' },
  avif: { contentType: 'image/avif', extension: 'avif' },
  tiff: { contentType: 'image/tiff', extension: 'tiff' },
};

export function normalizeQuarterTurn(value: unknown): QuarterTurn | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const normalized = ((Math.round(value) % 360) + 360) % 360;
  return normalized === 90 || normalized === 180 || normalized === 270 ? normalized : null;
}

const countFrames = async (buffer: Buffer) => {
  const metadata = await sharp(buffer, { animated: true }).metadata();
  return Math.max(1, Math.round(metadata.pages ?? 1));
};

const prioritizeDeliveryVariants = (variants: string[]) =>
  [...new Set(variants)].sort((left, right) => {
    const score = (value: string) => {
      if (value.includes('/full')) return 0;
      if (value.includes('/public')) return 1;
      return 2;
    };
    return score(left) - score(right);
  });

export async function fetchImageRotationSource(
  image: CloudflareImageForRotation,
  options?: { expectedAnimated?: boolean }
): Promise<RotationSource> {
  let originalError: unknown;
  try {
    const original = await fetchOriginalImageBlob(image.id);
    return {
      ...original,
      frameCount: await countFrames(original.buffer),
      source: 'original-blob',
    };
  } catch (error) {
    originalError = error;
    console.info('[image-rotate] Original blob unavailable; trying delivery variants', {
      imageId: image.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  let best: RotationSource | null = null;
  const failures: string[] = [];
  for (const variantUrl of prioritizeDeliveryVariants(image.variants ?? [])) {
    try {
      const response = await fetch(variantUrl, {
        cache: 'no-store',
        headers: { Accept: 'image/webp,image/*;q=0.9,*/*;q=0.1' },
      });
      if (!response.ok) {
        failures.push(`${response.status} ${variantUrl}`);
        continue;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const candidate: RotationSource = {
        buffer,
        contentType: response.headers.get('content-type') || undefined,
        frameCount: await countFrames(buffer),
        source: 'delivery-variant',
      };
      if (!best || candidate.frameCount > best.frameCount) best = candidate;
      if (candidate.frameCount > 1) return candidate;
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (best && !options?.expectedAnimated) return best;
  if (best) {
    throw new Error(
      'Cloudflare denied original blob access and every delivery variant resolved to a still image. '
      + 'Grant Images Read permission to CLOUDFLARE_API_TOKEN and retry.'
    );
  }
  const originalMessage = originalError instanceof Error ? originalError.message : String(originalError);
  const failureSuffix = failures.length ? ` Delivery fallback errors: ${failures.join('; ')}` : '';
  throw new Error(`${originalMessage}.${failureSuffix}`);
}

const normalizeDelays = (raw: number[] | undefined, frameCount: number) =>
  Array.from({ length: frameCount }, (_entry, index) => {
    const value = raw?.[index] ?? raw?.[raw.length - 1];
    return typeof value === 'number' && Number.isFinite(value) && value > 0
      ? Math.max(1, Math.round(value))
      : DEFAULT_DELAY_MS;
  });

async function rotateAnimatedBuffer(
  source: Buffer,
  degrees: QuarterTurn,
  metadata: sharp.Metadata
): Promise<RotatedImageBuffer> {
  const frameCount = Math.max(1, Math.round(metadata.pages ?? 1));
  const width = metadata.width;
  const pageHeight = metadata.pageHeight;
  if (!width || !pageHeight || frameCount < 2) {
    throw new Error('Animated image dimensions could not be resolved');
  }

  // Animated Sharp output is a stack of fully composited RGBA pages. Rotate
  // each page separately so page boundaries remain valid after quarter turns.
  const raw = await sharp(source, { animated: true }).ensureAlpha().raw().toBuffer();
  const frameSize = width * pageHeight * 4;
  if (raw.byteLength < frameSize * frameCount) {
    throw new Error('Animated image frame data is incomplete');
  }

  const rotatedFrames = await Promise.all(
    Array.from({ length: frameCount }, async (_entry, index) =>
      sharp(raw.subarray(index * frameSize, (index + 1) * frameSize), {
        raw: { width, height: pageHeight, channels: 4 },
      })
        .rotate(degrees)
        .raw()
        .toBuffer()
    )
  );
  const outputWidth = degrees === 90 || degrees === 270 ? pageHeight : width;
  const outputHeight = degrees === 90 || degrees === 270 ? width : pageHeight;
  const delays = normalizeDelays(metadata.delay, frameCount);
  const loop = typeof metadata.loop === 'number' ? metadata.loop : 0;
  const buffer = await sharp(Buffer.concat(rotatedFrames), {
    raw: {
      width: outputWidth,
      height: outputHeight * frameCount,
      channels: 4,
      pageHeight: outputHeight,
    },
  })
    .webp({ quality: 85, effort: 4, delay: delays, loop })
    .toBuffer();

  return {
    buffer,
    contentType: 'image/webp',
    extension: 'webp',
    width: outputWidth,
    height: outputHeight,
    animated: true,
    frameCount,
    delaysPreserved: true,
    loop,
  };
}

export async function rotateImageBuffer(
  source: Buffer,
  degrees: QuarterTurn
): Promise<RotatedImageBuffer> {
  const metadata = await sharp(source, { animated: true }).metadata();
  const frameCount = Math.max(1, Math.round(metadata.pages ?? 1));
  if (frameCount > 1) {
    return rotateAnimatedBuffer(source, degrees, metadata);
  }

  const format = metadata.format as keyof FormatEnum | undefined;
  const output = format ? FORMAT_TO_OUTPUT[format] : undefined;
  const safeFormat = output ? format! : 'jpeg';
  const safeOutput = output ?? FORMAT_TO_OUTPUT.jpeg!;
  const pipeline = sharp(source).rotate(degrees).toFormat(safeFormat, { quality: 85 });
  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  return {
    buffer: data,
    contentType: safeOutput.contentType,
    extension: safeOutput.extension,
    width: info.width,
    height: info.height,
    animated: false,
    frameCount: 1,
    delaysPreserved: false,
  };
}

const buildRotatedFilename = (filename: string, degrees: QuarterTurn, extension: string) => {
  const base = sanitizeFilename(filename).replace(/\.[^.]+$/, '') || 'image';
  return sanitizeFilename(`${base}-rotated-${degrees}.${extension}`);
};

export async function rotateCloudflareImage(
  imageId: string,
  degrees: QuarterTurn
): Promise<ImageRotationResult> {
  const credentials = getCloudflareCredentials();
  const [image, extras] = await Promise.all([
    fetchCloudflareImage(imageId, credentials),
    getImageExtrasRecord(imageId),
  ]);
  const metadata = parseCloudflareMetadata(image.meta);
  const source = await fetchImageRotationSource(image, {
    expectedAnimated: metadata.isAnimated === true,
  });
  const rotated = await rotateImageBuffer(source.buffer, degrees);
  const rotatedAt = new Date().toISOString();
  const filename = buildRotatedFilename(image.filename || 'image', degrees, rotated.extension);
  const upload = await uploadImageBuffer({
    buffer: rotated.buffer,
    originalBuffer: rotated.buffer,
    fileName: filename,
    fileType: rotated.contentType,
    fileSize: rotated.buffer.byteLength,
    context: {
      ...credentials,
      folder: extras?.folder ?? metadata.folder,
      tags: Array.isArray(metadata.tags) ? metadata.tags : [],
      displayName: filename,
      description: extras?.description ?? metadata.description,
      originalUrl: extras?.originalUrl ?? metadata.originalUrl,
      sourceUrl: extras?.sourceUrl ?? metadata.sourceUrl,
      sourcePath: typeof metadata.sourcePath === 'string' ? metadata.sourcePath : undefined,
      namespace: metadata.namespace,
      parentId: typeof metadata.variationParentId === 'string'
        ? metadata.variationParentId
        : image.id,
      generatedBy: typeof metadata.generatedBy === 'string' ? metadata.generatedBy : undefined,
      comfyMetadataDetected: metadata.comfyMetadataDetected === true ? true : undefined,
      comfyMetadataSource: typeof metadata.comfyMetadataSource === 'string'
        ? metadata.comfyMetadataSource
        : undefined,
      rotatedFromId: image.id,
      rotatedAt,
      rotationDegrees: degrees,
      isAnimated: rotated.animated,
    },
  });
  if (!upload.ok) {
    const error = new Error(upload.error) as Error & { status?: number };
    error.status = upload.status;
    throw error;
  }

  return {
    ...rotated,
    id: upload.data.id,
    filename: upload.data.filename,
    url: upload.data.url,
    variants: upload.data.variants,
    parentId: upload.data.parentId,
    rotatedFromId: image.id,
    rotatedAt,
    rotationDegrees: degrees,
  };
}
