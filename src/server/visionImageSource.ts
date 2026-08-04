import { fetchCloudflareImage } from '@/server/cloudflareClient';
import { isSvgFilename, resolveRasterVariantUrl } from '@/server/rasterForVision';
import { parseCloudflareMetadata } from '@/utils/cloudflareMetadata';

type CloudflareImageLike = {
  id?: string;
  filename?: string;
  variants?: string[];
  meta?: unknown;
};

/**
 * Delivery URL to hand a vision provider for a stored image.
 *
 * SVG assets resolve to their rasterized WebP companion — OpenAI vision and the
 * CLIP providers cannot decode `image/svg+xml`, and Cloudflare does not transform
 * SVG, so the raw delivery URL is unusable for anything generative. Raster assets
 * resolve exactly as before.
 */
export async function resolveVisionImageUrl(
  image: CloudflareImageLike,
  credentials?: { accountId: string; apiToken: string }
): Promise<string | undefined> {
  const filename = typeof image.filename === 'string' ? image.filename : undefined;
  const variants = Array.isArray(image.variants) ? image.variants : undefined;

  if (!isSvgFilename(filename)) {
    return resolveRasterVariantUrl({ id: image.id ?? '', filename, variants });
  }

  const linkedAssetId = parseCloudflareMetadata(image.meta).linkedAssetId?.trim();
  let linkedVariants: string[] | undefined;
  if (linkedAssetId && linkedAssetId !== image.id) {
    try {
      const linked = await fetchCloudflareImage(linkedAssetId, credentials);
      linkedVariants = Array.isArray(linked?.variants) ? linked.variants : undefined;
    } catch (error) {
      // Fall through to the SVG's own variants; the caller reports the provider error.
      console.warn('[visionImageSource] Failed to load rasterized companion', {
        imageId: image.id,
        linkedAssetId,
        error,
      });
    }
  }

  return resolveRasterVariantUrl({ id: image.id ?? '', filename, linkedAssetId, variants }, linkedVariants);
}
