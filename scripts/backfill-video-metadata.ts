#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { enrichVideoAssetMetadata } from '@/server/assetMetadataEnrichment';
import { listVideoAssetRecordsWithSync } from '@/server/videoCatalogStorage';
import { FileClientPageProjectStore } from '@/features/client-pages/storage/fileStore';

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

  logger('Loading video catalog');
  let videos = await listVideoAssetRecordsWithSync();
  if (publishedOnly) {
    const store = new FileClientPageProjectStore();
    const referencedIds = new Set(
      (await store.list())
        .filter((project) => project.remoteProjectId && project.selectedImageIds.length > 0)
        .flatMap((project) => project.selectedImageIds)
    );
    videos = videos.filter((video) => referencedIds.has(video.id));
  }

  videos = videos.filter((video) => matchesNamespace(video.namespace, namespace));
  if (!force) {
    videos = videos.filter(
      (video) =>
        !(typeof video.fileSizeBytes === 'number' && video.fileSizeBytes > 0) ||
        !(typeof video.durationSeconds === 'number' && video.durationSeconds > 0) ||
        !(video.aspectRatio || (video.width && video.height))
    );
  }
  if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
    videos = videos.slice(0, Math.floor(limit));
  }

  logger(`Backfilling ${videos.length} video records`);
  let updated = 0;
  for (const [index, video] of videos.entries()) {
    logger(`Processing ${index + 1}/${videos.length}: ${video.id} (${video.filename})`);
    const enriched = await enrichVideoAssetMetadata(video);
    const changed =
      force ||
      (enriched?.fileSizeBytes ?? 0) !== (video.fileSizeBytes ?? 0) ||
      (enriched?.durationSeconds ?? 0) !== (video.durationSeconds ?? 0) ||
      enriched?.aspectRatio !== video.aspectRatio ||
      enriched?.width !== video.width ||
      enriched?.height !== video.height;
    if (changed) updated += 1;
  }

  logger(`Complete. Updated ${updated} videos.`);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
