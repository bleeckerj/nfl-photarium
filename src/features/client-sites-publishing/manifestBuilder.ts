import { getCachedImages, type CachedCloudflareImage } from '@/server/cloudflareImageCache';
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

const createStablePublicAssetId = async (
  projectPublicSlug: string,
  sourceImageId: string
): Promise<string> => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${projectPublicSlug}:${sourceImageId}`)
  );

  const bytes = new Uint8Array(digest).slice(0, 16);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const toPublishedAssetPayload = async (
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
    projectAssetId: await createStablePublicAssetId(projectPublicSlug, image.id),
    sourceImageId: image.id,
    filename: image.filename,
    displayName: image.displayName,
    description: image.description,
    visibleTags,
    sourceTags: image.tags ?? [],
    uploadedAt: image.uploaded,
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

export const buildPublishedProjectManifest = async (
  request: ClientSiteManifestRequest
): Promise<PublishedProjectManifestPayload> => {
  const allImages = await getCachedImages(false);
  const imageMap = new Map(allImages.map((image) => [image.id, image]));

  const selectedImages = request.selection.imageIds
    .map((imageId) => imageMap.get(imageId))
    .filter((image): image is CachedCloudflareImage => Boolean(image));

  if (selectedImages.length !== request.selection.imageIds.length) {
    const missingIds = request.selection.imageIds.filter((imageId) => !imageMap.has(imageId));
    throw new Error(`Unknown image ids: ${missingIds.join(', ')}`);
  }

  const assets = await Promise.all(
    selectedImages.map((image, index) =>
      toPublishedAssetPayload(request.project.publicSlug, image, index, request)
    )
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
          new Set(selectedImages.map((image) => image.namespace).filter(Boolean))
        ) as string[],
    },
    assets,
  };
};

