import type { VideoAssetRecord } from '@/server/videoCatalogStorage';

export type ComfyProvenance = {
  generatedBy?: string;
  comfyMetadataDetected?: boolean;
  comfyMetadataSource?: string;
};

type ImageLike = ComfyProvenance & {
  id: string;
};

const isComfyProvenance = (value: ComfyProvenance | null | undefined) => {
  const generatedBy = typeof value?.generatedBy === 'string' ? value.generatedBy.toLowerCase() : '';
  return generatedBy === 'comfyui' || value?.comfyMetadataDetected === true || Boolean(value?.comfyMetadataSource);
};

export function buildVideoAnimatedWebpComfyProvenanceMap(
  videos: Pick<
    VideoAssetRecord,
    | 'generatedBy'
    | 'comfyMetadataDetected'
    | 'comfyMetadataSource'
    | 'animatedWebpImageId'
    | 'animatedWebpVariants'
  >[]
): Map<string, ComfyProvenance> {
  const map = new Map<string, ComfyProvenance>();

  for (const video of videos) {
    if (!isComfyProvenance(video)) continue;
    const provenance: ComfyProvenance = {
      generatedBy: video.generatedBy,
      comfyMetadataDetected: video.comfyMetadataDetected,
      comfyMetadataSource: video.comfyMetadataSource,
    };
    if (video.animatedWebpImageId) {
      map.set(video.animatedWebpImageId, provenance);
    }
    for (const variant of video.animatedWebpVariants ?? []) {
      if (variant.imageId) {
        map.set(variant.imageId, provenance);
      }
    }
  }

  return map;
}

export function applyVideoAnimatedWebpComfyProvenance<T extends ImageLike>(
  images: T[],
  provenanceByImageId: Map<string, ComfyProvenance>
): T[] {
  if (provenanceByImageId.size === 0) return images;

  return images.map((image) => {
    if (isComfyProvenance(image)) return image;
    const provenance = provenanceByImageId.get(image.id);
    if (!provenance) return image;
    return {
      ...image,
      generatedBy: provenance.generatedBy,
      comfyMetadataDetected: provenance.comfyMetadataDetected,
      comfyMetadataSource: provenance.comfyMetadataSource,
    };
  });
}
