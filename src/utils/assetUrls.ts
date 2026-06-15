import { getCloudflareImageUrl, getCloudflareSvgOriginalUrl } from '@/utils/imageUtils';

export type AssetLike = {
  id: string;
  assetType?: 'image' | 'video';
  filename?: string;
  linkedAssetId?: string;
  variants?: string[];
  videoPlaybackUrl?: string;
  videoHlsUrl?: string;
  videoThumbnailUrl?: string;
  videoPreviewUrl?: string;
};

const firstNonEmpty = (values: Array<string | undefined>) =>
  values.find((value) => typeof value === 'string' && value.trim().length > 0);

export const isVideoAsset = (asset: Pick<AssetLike, 'assetType'> | null | undefined) =>
  asset?.assetType === 'video';

const isSvgAsset = (asset: Pick<AssetLike, 'filename'>) =>
  asset.filename?.toLowerCase().endsWith('.svg') ?? false;

// Resolve the image id to display/transform for a given asset. SVGs route to
// their rasterized WebP variant (XSS-immune, Cloudflare-transformable) when one
// exists; the bare SVG id is only used as a last-resort legacy fallback.
const resolveImageSourceId = (asset: AssetLike): { id: string; isRawSvg: boolean } => {
  if (isSvgAsset(asset)) {
    if (asset.linkedAssetId) return { id: asset.linkedAssetId, isRawSvg: false };
    return { id: asset.id, isRawSvg: true };
  }
  return { id: asset.id, isRawSvg: false };
};

export const getAssetDetailPath = (asset: Pick<AssetLike, 'id' | 'assetType'>) =>
  isVideoAsset(asset) ? `/videos/${asset.id}` : `/images/${asset.id}`;

export const getAssetPreviewUrl = (
  asset: AssetLike,
  options?: { imageVariant?: string }
): string => {
  if (isVideoAsset(asset)) {
    return (
      firstNonEmpty([
        asset.videoThumbnailUrl,
        asset.videoPreviewUrl,
        ...(Array.isArray(asset.variants) ? asset.variants : []),
      ]) || ''
    );
  }

  const { id, isRawSvg } = resolveImageSourceId(asset);
  if (isRawSvg) return getCloudflareSvgOriginalUrl(id);
  return getCloudflareImageUrl(id, options?.imageVariant || 'public');
};

export const getAssetCopyUrl = (
  asset: AssetLike,
  options?: { imageVariant?: string }
): string => {
  if (isVideoAsset(asset)) {
    return (
      firstNonEmpty([
        asset.videoPlaybackUrl,
        asset.videoHlsUrl,
        asset.videoThumbnailUrl,
        asset.videoPreviewUrl,
        ...(Array.isArray(asset.variants) ? asset.variants : []),
      ]) || ''
    );
  }

  const { id, isRawSvg } = resolveImageSourceId(asset);
  if (isRawSvg) return getCloudflareSvgOriginalUrl(id);
  return getCloudflareImageUrl(id, options?.imageVariant || 'original');
};
