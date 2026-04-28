import { getCachedImages, type CachedCloudflareImage } from '@/server/cloudflareImageCache';
import { listVideoAssetRecordsWithSync, type VideoAssetRecord } from '@/server/videoCatalogStorage';
import { resolveVideoDownloadUrl } from '@/server/videoDownloadUrl';
import {
  enrichAssetsForPublishing,
  getMissingPublishMetadataReasons,
} from '@/server/assetMetadataEnrichment';
import {
  defaultClientSiteAccessPolicy,
  defaultClientSiteDownloadPresetPolicy,
  defaultClientSiteVisibleTagPolicy,
} from './defaults';
import { filterVisibleTags } from './tagVisibility';
import type {
  ClientSiteManifestRequest,
  PublishedProjectAssetPayload,
  PublishedProjectManifestPayload,
} from './types';

const isVideoAssetRecord = (
  asset: CachedCloudflareImage | VideoAssetRecord
): asset is VideoAssetRecord => 'assetType' in asset && asset.assetType === 'video';

const createStablePublicAssetId = async (
  projectPublicSlug: string,
  sourceAssetId: string
): Promise<string> => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${projectPublicSlug}:${sourceAssetId}`)
  );

  const bytes = new Uint8Array(digest).slice(0, 16);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const toPublishedImageAssetPayload = async (
  projectPublicSlug: string,
  image: CachedCloudflareImage,
  sortOrder: number,
  request: ClientSiteManifestRequest
): Promise<PublishedProjectAssetPayload> => {
  const visibleTags = filterVisibleTags(
    image.tags,
    request.visibleTagPolicy ?? defaultClientSiteVisibleTagPolicy
  );

  return {
    assetType: 'image',
    projectAssetId: await createStablePublicAssetId(projectPublicSlug, image.id),
    sourceAssetId: image.id,
    filename: image.filename,
    displayName: image.displayName,
    description: image.description,
    visibleTags,
    sourceTags: image.tags ?? [],
    uploadedAt: image.uploaded,
    fileSizeBytes: image.size,
    aspectRatio: image.aspectRatio,
    dimensions: image.dimensions,
    isCanonical: !image.parentId,
    hasEmbedding: Boolean(image.hasClipEmbedding),
    clusterSeed: visibleTags[0]
      ? {
          id: visibleTags[0],
          label: visibleTags[0],
        }
      : undefined,
    previewVariant: 'public',
    sortOrder,
  };
};

const toPublishedVideoAssetPayload = async (
  projectPublicSlug: string,
  video: VideoAssetRecord,
  sortOrder: number,
  request: ClientSiteManifestRequest
): Promise<PublishedProjectAssetPayload> => {
  const visibleTags = filterVisibleTags(
    video.tags,
    request.visibleTagPolicy ?? defaultClientSiteVisibleTagPolicy
  );

  return {
    assetType: 'video',
    projectAssetId: await createStablePublicAssetId(projectPublicSlug, video.id),
    sourceAssetId: video.id,
    filename: video.filename,
    displayName: video.displayName,
    description: video.description,
    visibleTags,
    sourceTags: video.tags ?? [],
    uploadedAt: video.uploaded,
    fileSizeBytes: video.fileSizeBytes,
    aspectRatio: video.aspectRatio,
    dimensions: video.width && video.height ? { width: video.width, height: video.height } : undefined,
    isCanonical: !video.parentId,
    hasEmbedding: Boolean(video.hasClipEmbedding),
    clusterSeed: visibleTags[0]
      ? {
          id: visibleTags[0],
          label: visibleTags[0],
        }
      : undefined,
    videoPlaybackUrl: video.playbackUrl,
    videoHlsUrl: video.hlsUrl,
    videoThumbnailUrl: video.thumbnailUrl,
    videoPreviewUrl: video.previewUrl,
    videoDownloadUrl: resolveVideoDownloadUrl(video) || undefined,
    videoDurationSeconds:
      typeof video.durationSeconds === 'number' && video.durationSeconds > 0
        ? video.durationSeconds
        : undefined,
    sortOrder,
  };
};

export const buildPublishedProjectManifest = async (
  request: ClientSiteManifestRequest
): Promise<PublishedProjectManifestPayload> => {
  const [allImages, allVideos] = await Promise.all([
    getCachedImages(false),
    listVideoAssetRecordsWithSync(),
  ]);
  const imageMap = new Map(allImages.map((image) => [image.id, image]));
  const videoMap = new Map(allVideos.map((video) => [video.id, video]));
  const selectedAssets = request.selection.assetIds.map((assetId) => {
    const image = imageMap.get(assetId);
    if (image) return image;
    return videoMap.get(assetId) || null;
  });
  const missingIds = request.selection.assetIds.filter(
    (assetId) => !imageMap.has(assetId) && !videoMap.has(assetId)
  );
  if (missingIds.length > 0) {
    throw new Error(`Unknown asset ids: ${missingIds.join(', ')}`);
  }

  const enriched = await enrichAssetsForPublishing(request.selection.assetIds);
  const readyAssets = selectedAssets.map((asset) => {
    if (!asset) return null;
    return isVideoAssetRecord(asset)
      ? enriched.videos.get(asset.id) ?? asset
      : enriched.images.get(asset.id) ?? asset;
  });
  const incompleteAssets = readyAssets
    .filter((asset): asset is CachedCloudflareImage | VideoAssetRecord => Boolean(asset))
    .map((asset) => ({
      id: asset.id,
      filename: asset.filename,
      assetType: 'assetType' in asset && asset.assetType === 'video' ? 'video' : 'image',
      missing: getMissingPublishMetadataReasons(asset),
    }))
    .filter((asset) => asset.missing.length > 0);
  if (incompleteAssets.length > 0) {
    const detail = incompleteAssets
      .map((asset) => `${asset.assetType}:${asset.id} (${asset.filename}) missing ${asset.missing.join(', ')}`)
      .join('; ');
    throw new Error(`Unable to publish assets with incomplete metadata: ${detail}`);
  }

  const assets = await Promise.all(
    readyAssets.map((asset, index) => {
      if (!asset) {
        throw new Error('Encountered null asset during manifest build.');
      }
      return isVideoAssetRecord(asset)
        ? toPublishedVideoAssetPayload(request.project.publicSlug, asset, index, request)
        : toPublishedImageAssetPayload(request.project.publicSlug, asset, index, request);
    })
  );

  return {
    schemaVersion: '2026-04-01',
    project: {
      id: request.project.id,
      publicSlug: request.project.publicSlug,
      status: request.project.status ?? 'published',
      expiresAt: request.project.expiresAt ?? null,
      title: request.project.title,
      accessPolicy: request.accessPolicy ?? defaultClientSiteAccessPolicy,
      visibleTagPolicy: request.visibleTagPolicy ?? defaultClientSiteVisibleTagPolicy,
      downloadPresetPolicy:
        request.downloadPresetPolicy ?? defaultClientSiteDownloadPresetPolicy,
    },
    delivery: request.downloadPresetPolicy ?? defaultClientSiteDownloadPresetPolicy,
    revision: {
      projectRevisionId: crypto.randomUUID(),
      generatedAt: new Date().toISOString(),
      sourceNamespaces:
        request.project.sourceNamespaces ??
        Array.from(
          new Set(selectedAssets.map((asset) => asset?.namespace).filter(Boolean))
        ) as string[],
    },
    assets,
  };
};
