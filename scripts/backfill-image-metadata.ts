#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { loadEnvConfig } from '@next/env';
import {
  flushCloudflareImageCachePersistence,
  getCachedImages,
} from '@/server/cloudflareImageCache';
import { enrichImageAssetMetadata } from '@/server/assetMetadataEnrichment';
import { batchGetAspectMetadata } from '@/server/vectorSearch';
import { FileClientPageProjectStore } from '@/features/client-pages/storage/fileStore';

loadEnvConfig(process.cwd());

const logger = (message: string) => {
  const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
  console.log(`[${timestamp}] ${message}`);
};

const matchesNamespace = (assetNamespace: string | undefined, namespace: string | null) => {
  if (namespace === null) return true;
  if (namespace === '') return !assetNamespace;
  return assetNamespace === namespace;
};

const main = async () => {
  const { values } = parseArgs({
    options: {
      namespace: { type: 'string' },
      limit: { type: 'string' },
      concurrency: { type: 'string' },
      force: { type: 'boolean' },
      'published-only': { type: 'boolean' },
    },
  });

  const namespaceFlag = typeof values.namespace === 'string' ? values.namespace : undefined;
  const namespace =
    namespaceFlag === '__all__'
      ? null
      : namespaceFlag === '__none__'
        ? ''
        : namespaceFlag ?? null;
  const limit = typeof values.limit === 'string' ? Number(values.limit) : undefined;
  const configuredConcurrency = typeof values.concurrency === 'string'
    ? Number(values.concurrency)
    : 8;
  const concurrency = Number.isFinite(configuredConcurrency) && configuredConcurrency > 0
    ? Math.min(16, Math.floor(configuredConcurrency))
    : 8;
  const force = values.force === true;
  const publishedOnly = values['published-only'] === true;

  logger('Loading image catalog');
  let images = await getCachedImages(false);
  if (publishedOnly) {
    const store = new FileClientPageProjectStore();
    const referencedIds = new Set(
      (await store.list())
        .filter((project) => project.remoteProjectId && project.selectedImageIds.length > 0)
        .flatMap((project) => project.selectedImageIds)
    );
    images = images.filter((image) => referencedIds.has(image.id));
  }

  images = images.filter((image) => matchesNamespace(image.namespace, namespace));
  if (!force) {
    const indexedAspectMetadata = await batchGetAspectMetadata(images.map((image) => image.id));
    images = images.filter((image) => {
      const indexed = indexedAspectMetadata.get(image.id);
      return !(indexed?.aspectRatioClass && indexed.width && indexed.height);
    });
  }
  if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
    images = images.slice(0, Math.floor(limit));
  }

  logger(`Backfilling ${images.length} image records`);
  let updated = 0;
  let failed = 0;
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= images.length) return;

      const image = images[index];
      logger(`Processing ${index + 1}/${images.length}: ${image.id} (${image.filename})`);
      try {
        const enriched = await enrichImageAssetMetadata(image, { includeSize: false });
        const changed =
          force ||
          enriched?.aspectRatio !== image.aspectRatio ||
          enriched?.dimensions?.width !== image.dimensions?.width ||
          enriched?.dimensions?.height !== image.dimensions?.height;
        if (changed) updated += 1;
      } catch (error) {
        failed += 1;
        logger(
          `Failed ${index + 1}/${images.length}: ${image.id} (${image.filename}) - ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, images.length) }, () => worker()));
  await flushCloudflareImageCachePersistence();

  logger(`Complete. Updated ${updated} images. Failed ${failed} images.`);
};

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
