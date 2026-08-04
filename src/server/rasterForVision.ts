import sharp from 'sharp';
import { sanitizeSvgBuffer } from '@/server/svgSanitizer';

/**
 * Rasterization shim for generative/vision calls.
 *
 * OpenAI vision and the CLIP providers only accept raster formats — an SVG sent
 * as `data:image/svg+xml;base64,...` (or as a raw `.svg` URL) comes back as
 * "You uploaded an unsupported image. Please make sure your image has of one the
 * following formats: ['png', 'jpeg', 'gif', 'webp']".
 *
 * After upload an SVG has a rasterized WebP companion to fall back on
 * (see `resolveRasterSourceId`), but the uploader's pre-upload AI naming pass runs
 * before anything is stored, so there is nothing to look up — the bytes have to be
 * rasterized on the fly.
 *
 * SVG is sanitized before it reaches sharp: librsvg will resolve references while
 * rendering, and every other SVG path in this codebase sanitizes first.
 */

/** Longest edge of the rasterized output. Keeps base64 data URIs well inside vision payload limits. */
const VISION_RASTER_EDGE = 1024;

const SVG_MIME = 'image/svg+xml';

export type VisionImage = {
  buffer: Buffer;
  /** Mime of the returned bytes — `image/webp` whenever rasterization happened. */
  mime: string;
  rasterized: boolean;
};

export class VisionRasterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VisionRasterError';
  }
}

export const isSvgMime = (mime?: string | null): boolean =>
  typeof mime === 'string' && mime.trim().toLowerCase().startsWith(SVG_MIME);

export const isSvgFilename = (name?: string | null): boolean =>
  typeof name === 'string' && name.trim().toLowerCase().endsWith('.svg');

/**
 * Return bytes a vision/embedding provider can decode.
 *
 * Raster input is passed through untouched so existing behaviour is unchanged;
 * only SVG is sanitized and rasterized to WebP.
 */
export async function toVisionImage(
  buffer: Buffer,
  mime?: string | null,
  fileName?: string | null
): Promise<VisionImage> {
  const looksLikeSvg = isSvgMime(mime) || (!mime && isSvgFilename(fileName));
  if (!looksLikeSvg) {
    return { buffer, mime: mime?.trim() || 'image/jpeg', rasterized: false };
  }

  const sanitized = sanitizeSvgBuffer(buffer);
  if (!sanitized.ok) {
    throw new VisionRasterError(`Could not read SVG for AI processing: ${sanitized.error}`);
  }

  try {
    const raster = await sharp(sanitized.buffer)
      .resize(VISION_RASTER_EDGE, VISION_RASTER_EDGE, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      // SVGs are frequently line art on transparency; flatten so the subject is
      // not judged against a black background once alpha is discarded.
      .flatten({ background: '#ffffff' })
      .webp({ quality: 85 })
      .toBuffer();
    return { buffer: raster, mime: 'image/webp', rasterized: true };
  } catch (error) {
    throw new VisionRasterError(
      `Could not rasterize SVG for AI processing: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

type RasterSourceCandidate = {
  id: string;
  filename?: string | null;
  linkedAssetId?: string | null;
};

/**
 * Server-side twin of `resolveImageSourceId` in `@/utils/assetUrls`.
 *
 * For a stored SVG this returns the id of its rasterized WebP companion, so vision
 * and embedding calls operate on bytes the provider can decode. Falls back to the
 * asset's own id when no companion exists (legacy records), and returns the id
 * untouched for raster assets.
 *
 * Detection is by filename, not by the `type` metadata: companions historically
 * inherited `type: image/svg+xml` from their parent, so `type` cannot be trusted.
 */
export const resolveRasterSourceId = (asset: RasterSourceCandidate): string => {
  if (!isSvgFilename(asset.filename)) return asset.id;
  const linked = asset.linkedAssetId?.trim();
  return linked || asset.id;
};

/**
 * Pick the delivery URL to hand a vision provider, preferring the rasterized
 * companion for SVG assets. Returns undefined when nothing is servable.
 */
export const resolveRasterVariantUrl = (
  asset: RasterSourceCandidate & { variants?: string[] },
  linkedVariants?: string[]
): string | undefined => {
  const pickPublic = (variants?: string[]) =>
    Array.isArray(variants)
      ? variants.find((url) => typeof url === 'string' && url.includes('/public')) ||
        variants.find((url) => typeof url === 'string')
      : undefined;

  if (isSvgFilename(asset.filename) && asset.linkedAssetId?.trim()) {
    const linked = pickPublic(linkedVariants);
    if (linked) return linked;
  }
  return pickPublic(asset.variants);
};

/** Build a `data:` URI a vision provider can consume, rasterizing SVG first. */
export async function toVisionDataUrl(
  buffer: Buffer,
  mime?: string | null,
  fileName?: string | null
): Promise<string> {
  const image = await toVisionImage(buffer, mime, fileName);
  return `data:${image.mime};base64,${image.buffer.toString('base64')}`;
}
