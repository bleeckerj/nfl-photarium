import sharp from 'sharp';
import { getCloudflareImageUrl, calculateAspectRatio } from '@/utils/imageUtils';

export type AspectRatioClass = 'horizontal' | 'vertical' | 'square';

const SQUARE_TOLERANCE = 0.05;

export const classifyAspectRatio = (width: number, height: number): AspectRatioClass => {
  const ratio = width / height;
  if (Math.abs(ratio - 1) <= SQUARE_TOLERANCE) return 'square';
  return ratio > 1 ? 'horizontal' : 'vertical';
};

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