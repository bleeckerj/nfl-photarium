import {
  transformApiImageToCached,
  upsertCachedImage,
  type CachedCloudflareImage,
} from './cloudflareImageCache';
import type { CloudflareMetadata } from '@/utils/cloudflareMetadata';

type UploadedCloudflareImage = {
  id: string;
  filename: string;
  uploaded: string;
  variants: string[];
  size?: number;
};

export const cacheUploadedCloudflareImage = async (
  image: UploadedCloudflareImage,
  metadata: CloudflareMetadata
): Promise<CachedCloudflareImage> => {
  const cached = transformApiImageToCached({
    id: image.id,
    filename: image.filename,
    uploaded: image.uploaded,
    variants: image.variants,
    size: image.size,
    meta: metadata,
  });
  await upsertCachedImage(cached);
  return cached;
};
