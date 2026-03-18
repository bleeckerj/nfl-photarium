import { getCloudflareImageUrl } from '@/utils/imageUtils';

export type AssetLike = {
  id: string;
  assetType?: 'image' | 'video';
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
        asset.videoPlaybackUrl,
        asset.videoHlsUrl,
      ]) || ''
    );
  }

  return getCloudflareImageUrl(asset.id, options?.imageVariant || 'public');
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

  return getCloudflareImageUrl(asset.id, options?.imageVariant || 'original');
};
