import { patchCloudflareImageMetadata } from '@/server/cloudflareImageMetadata';
import { getCachedImages } from '@/server/cloudflareImageCache';
import {
  listVideoAssetRecords,
  updateVideoAssetRecord,
} from '@/server/videoCatalogStorage';
import {
  DEFAULT_NAMESPACE,
  isProtectedRegistryNamespace,
  normalizeRegistryNamespace,
  removeRegistryNamespace,
  upsertRegistryNamespace,
} from '@/server/namespaceRegistry';

export type NamespaceDeletionFailure = {
  id: string;
  assetType: 'image' | 'video';
  error: string;
};

export type NamespaceDeletionResult = {
  namespace: string;
  targetNamespace: string;
  dryRun: boolean;
  partialFailure: boolean;
  imageCount: number;
  videoCount: number;
  imageIds: string[];
  videoIds: string[];
  movedImageIds: string[];
  movedVideoIds: string[];
  failures: NamespaceDeletionFailure[];
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export const validateNamespaceDeletionName = (namespace?: string) => {
  const normalized = normalizeRegistryNamespace(namespace);
  if (!normalized) {
    return { ok: false as const, error: 'A deletable namespace is required.' };
  }
  if (isProtectedRegistryNamespace(normalized)) {
    return { ok: false as const, error: `Namespace "${normalized}" cannot be deleted.` };
  }
  return { ok: true as const, namespace: normalized };
};

export const deleteNamespaceByMovingAssets = async (
  namespace: string,
  options: { dryRun?: boolean } = {}
): Promise<NamespaceDeletionResult> => {
  const validation = validateNamespaceDeletionName(namespace);
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  const sourceNamespace = validation.namespace;
  const dryRun = options.dryRun === true;
  const [cachedImages, videos] = await Promise.all([
    getCachedImages(),
    listVideoAssetRecords(),
  ]);
  const sourceImages = cachedImages.filter((image) => image.namespace === sourceNamespace);
  const sourceVideos = videos.filter((video) => video.namespace === sourceNamespace);
  const imageIds = sourceImages.map((image) => image.id);
  const videoIds = sourceVideos.map((video) => video.id);

  const base = {
    namespace: sourceNamespace,
    targetNamespace: DEFAULT_NAMESPACE,
    dryRun,
    partialFailure: false,
    imageCount: imageIds.length,
    videoCount: videoIds.length,
    imageIds,
    videoIds,
    movedImageIds: [] as string[],
    movedVideoIds: [] as string[],
    failures: [] as NamespaceDeletionFailure[],
  };

  if (dryRun) {
    return base;
  }

  await upsertRegistryNamespace(DEFAULT_NAMESPACE);

  const imageResults = await Promise.allSettled(
    imageIds.map(async (id) => {
      await patchCloudflareImageMetadata(
        id,
        (existingMeta) => ({
          ...existingMeta,
          updatedAt: new Date().toISOString(),
          namespace: DEFAULT_NAMESPACE,
        }),
        { requiredKeys: ['namespace'] }
      );
      return id;
    })
  );

  const videoResults = await Promise.allSettled(
    videoIds.map(async (id) => {
      const updated = await updateVideoAssetRecord(id, { namespace: DEFAULT_NAMESPACE });
      if (!updated) {
        throw new Error('Video not found');
      }
      return id;
    })
  );

  imageResults.forEach((result, index) => {
    const id = imageIds[index];
    if (result.status === 'fulfilled') {
      base.movedImageIds.push(result.value);
    } else {
      base.failures.push({ id, assetType: 'image', error: errorMessage(result.reason) });
    }
  });

  videoResults.forEach((result, index) => {
    const id = videoIds[index];
    if (result.status === 'fulfilled') {
      base.movedVideoIds.push(result.value);
    } else {
      base.failures.push({ id, assetType: 'video', error: errorMessage(result.reason) });
    }
  });

  base.partialFailure = base.failures.length > 0;
  if (!base.partialFailure) {
    await removeRegistryNamespace(sourceNamespace);
  }

  return base;
};
