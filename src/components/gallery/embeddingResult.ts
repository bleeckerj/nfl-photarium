import type { CloudflareImage } from './types';

interface GalleryEmbeddingResult {
  success?: boolean;
  clipGenerated?: boolean;
  colorGenerated?: boolean;
  hasClipEmbedding?: boolean;
  hasColorEmbedding?: boolean;
}

export const applyEmbeddingResultToImage = (
  image: CloudflareImage,
  result: GalleryEmbeddingResult
): CloudflareImage => ({
  ...image,
  hasClipEmbedding: result.hasClipEmbedding ?? result.clipGenerated ?? image.hasClipEmbedding,
  hasColorEmbedding: result.hasColorEmbedding ?? result.colorGenerated ?? image.hasColorEmbedding,
});
