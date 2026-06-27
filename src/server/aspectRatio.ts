import sharp from 'sharp';
import { getCloudflareImageUrl, calculateAspectRatio } from '@/utils/imageUtils';
import {
  classifyAspectRatio,
  type AspectRatioClass,
} from '@/utils/aspectRatioClass';

export { classifyAspectRatio, type AspectRatioClass };

export const fetchImageDimensions = async (imageUrl: string): Promise<{ width: number; height: number }> => {
  const resp = await fetch(imageUrl);
  if (!resp.ok) {
    throw new Error(`Failed to fetch image for dimensions: ${resp.status}`);
  }
  const arrayBuffer = await resp.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const metadata = await sharp(buffer).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error('Unable to determine image dimensions');
  }
  return { width: metadata.width, height: metadata.height };
};

export const computeAspectRatioForImage = async (imageId: string): Promise<{
  width: number;
  height: number;
  aspectRatio: string;
  aspectRatioClass: AspectRatioClass;
}> => {
  const imageUrl = getCloudflareImageUrl(imageId, 'public');
  const { width, height } = await fetchImageDimensions(imageUrl);
  const ratio = calculateAspectRatio(width, height);
  return {
    width,
    height,
    aspectRatio: ratio.common,
    aspectRatioClass: classifyAspectRatio(width, height),
  };
};
