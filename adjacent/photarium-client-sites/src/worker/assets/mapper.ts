import type { ProjectAssetRecord } from './types';
import { resolveDownloadableVideoUrl, resolvePreferredVideoPlayback } from './video-playback';

/**
 * Public asset payload with worker-fronted URLs only.
 */
export const mapAssetToPublicPayload = (asset: ProjectAssetRecord) => {
  const preferredPlayback = resolvePreferredVideoPlayback(asset);
  const downloadableVideoUrl = resolveDownloadableVideoUrl(asset);
  const directVideoFileUrl = preferredPlayback.kind === 'file' ? preferredPlayback.url : null;
  return {
    id: asset.publicAssetId,
    assetType: asset.assetType,
    filename: asset.filename,
    displayName: asset.displayName ?? asset.filename,
    description: asset.description ?? '',
    visibleTags: asset.visibleTags,
    fileSizeBytes: asset.fileSizeBytes ?? null,
    aspectRatio: asset.aspectRatio ?? null,
    dimensions: asset.width && asset.height ? { width: asset.width, height: asset.height } : null,
    isCanonical: asset.isCanonical,
    hasEmbedding: asset.hasEmbedding,
    clusterId: asset.clusterId ?? null,
    clusterLabel: asset.clusterLabel ?? null,
    previewVariant: asset.previewVariant ?? null,
    // Only expose raw playback URLs when they are actual direct video files.
    videoPlaybackUrl: directVideoFileUrl,
    videoHlsUrl: asset.videoHlsUrl ?? null,
    videoThumbnailUrl: asset.videoThumbnailUrl ?? null,
    // Never expose iframe/watch preview URLs as public media endpoints.
    videoPreviewUrl: null,
    videoDownloadUrl: downloadableVideoUrl,
    preferredVideoPlaybackUrl: preferredPlayback.url,
    preferredVideoPlaybackKind: preferredPlayback.kind,
    hasDownloadableVideo: Boolean(downloadableVideoUrl),
    videoDurationSeconds: asset.videoDurationSeconds ?? null,
    sortOrder: asset.sortOrder,
  };
};
