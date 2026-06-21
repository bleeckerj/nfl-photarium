import { patchCloudflareImageMetadata } from '@/server/cloudflareImageMetadata';
import { getCachedImages } from '@/server/cloudflareImageCache';
import {
  listVideoAssetRecords,
  updateVideoAssetRecord,
} from '@/server/videoCatalogStorage';
import {
  isProtectedRegistryNamespace,
  listRegistryNamespaceDetails,
  normalizeRegistryNamespace,
  renameRegistryNamespace,
  upsertRegistryNamespace,
} from '@/server/namespaceRegistry';

export type NamespaceRenameFailure = {
  id: string;
  assetType: 'image' | 'video';
  error: string;
};

export type NamespaceRenameResult = {
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
  failures: NamespaceRenameFailure[];
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export const validateNamespaceRenameNames = (sourceNamespace?: string, targetNamespace?: string) => {
  const source = normalizeRegistryNamespace(sourceNamespace);
  const target = normalizeRegistryNamespace(targetNamespace);

  if (!source) {
    return { ok: false as const, error: 'A source namespace is required.' };
  }
  if (!target) {
    return { ok: false as const, error: 'A target namespace is required.' };
  }
  if (source === target) {
    return { ok: false as const, error: 'Choose a different target namespace.' };
  }
  if (isProtectedRegistryNamespace(source)) {
    return { ok: false as const, error: `Namespace "${source}" cannot be renamed.` };
  }
  if (isProtectedRegistryNamespace(target)) {
    return { ok: false as const, error: `Namespace "${target}" cannot be used as a rename target.` };
  }

  return { ok: true as const, sourceNamespace: source, targetNamespace: target };
};

export const renameNamespace = async (
  sourceNamespace: string,
  targetNamespace: string,
  options: { dryRun?: boolean } = {}
): Promise<NamespaceRenameResult> => {
  const validation = validateNamespaceRenameNames(sourceNamespace, targetNamespace);
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  const dryRun = options.dryRun === true;
  const [cachedImages, videos, registryDetails] = await Promise.all([
    getCachedImages(),
    listVideoAssetRecords(),
    listRegistryNamespaceDetails(),
  ]);
  const sourceImages = cachedImages.filter((image) => image.namespace === validation.sourceNamespace);
  const sourceVideos = videos.filter((video) => video.namespace === validation.sourceNamespace);
  const targetExists =
    registryDetails.some((entry) => entry.name === validation.targetNamespace) ||
    cachedImages.some((image) => image.namespace === validation.targetNamespace) ||
    videos.some((video) => video.namespace === validation.targetNamespace);

  if (targetExists) {
    throw new Error(`Namespace "${validation.targetNamespace}" already exists.`);
  }

  const imageIds = sourceImages.map((image) => image.id);
  const videoIds = sourceVideos.map((video) => video.id);
  const base: NamespaceRenameResult = {
    namespace: validation.sourceNamespace,
    targetNamespace: validation.targetNamespace,
    dryRun,
    partialFailure: false,
    imageCount: imageIds.length,
    videoCount: videoIds.length,
    imageIds,
    videoIds,
    movedImageIds: [],
    movedVideoIds: [],
    failures: [],
  };

  if (dryRun) {
    return base;
  }

  const sourceDescription =
    registryDetails.find((entry) => entry.name === validation.sourceNamespace)?.description ?? '';
  await upsertRegistryNamespace(validation.targetNamespace, sourceDescription);

  const imageResults = await Promise.allSettled(
    imageIds.map(async (id) => {
      await patchCloudflareImageMetadata(
        id,
        (existingMeta) => ({
          ...existingMeta,
          updatedAt: new Date().toISOString(),
          namespace: validation.targetNamespace,
        }),
        { requiredKeys: ['namespace'] }
      );
      return id;
    })
  );

  const videoResults = await Promise.allSettled(
    videoIds.map(async (id) => {
      const updated = await updateVideoAssetRecord(id, { namespace: validation.targetNamespace });
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
    await renameRegistryNamespace(validation.sourceNamespace, validation.targetNamespace);
  }

  return base;
};
