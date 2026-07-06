#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { loadEnvConfig } from '@next/env';
import { getCachedImages } from '@/server/cloudflareImageCache';
import { enrichImageAssetMetadata } from '@/server/assetMetadataEnrichment';
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
    images = images.filter(
      (image) =>
        !(typeof image.size === 'number' && image.size > 0) ||
        !(image.aspectRatio || (image.dimensions?.width && image.dimensions?.height))
    );
  }
  if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
    images = images.slice(0, Math.floor(limit));
  }

  logger(`Backfilling ${images.length} image records`);
  let updated = 0;
  for (const [index, image] of images.entries()) {
    logger(`Processing ${index + 1}/${images.length}: ${image.id} (${image.filename})`);
    const enriched = await enrichImageAssetMetadata(image);
    const changed =
      force ||
      (enriched?.size ?? 0) !== (image.size ?? 0) ||
      enriched?.aspectRatio !== image.aspectRatio ||
      enriched?.dimensions?.width !== image.dimensions?.width ||
      enriched?.dimensions?.height !== image.dimensions?.height;
    if (changed) updated += 1;
  }

  logger(`Complete. Updated ${updated} images.`);
};

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
