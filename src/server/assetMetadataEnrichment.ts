import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  getCachedImage,
  getCachedImages,
  type CachedCloudflareImage,
  upsertCachedImage,
} from '@/server/cloudflareImageCache';
import { probeVideoSource } from '@/server/videoFrameService';
import {
  getVideoAssetRecord,
  listVideoAssetRecordsWithSync,
  syncVideoAssetRecordFromStream,
  type VideoAssetRecord,
  updateVideoAssetRecord,
} from '@/server/videoCatalogStorage';
import { resolveVideoDownloadUrls } from '@/server/videoDownloadUrl';
import { classifyAspectRatio, fetchImageDimensions } from '@/server/aspectRatio';
import { storeImageAspectMetadata } from '@/server/vectorSearch';
import { getCloudflareImageUrl, calculateAspectRatio } from '@/utils/imageUtils';

type ResolvedSource =
  | { kind: 'remote'; value: string }
  | { kind: 'local'; value: string };

type ImageMetadataPatch = Partial<Pick<CachedCloudflareImage, 'size' | 'aspectRatio' | 'dimensions'>>;
export type ImageMetadataEnrichmentOptions = {
  includeSize?: boolean;
};
type VideoMetadataPatch = Partial<
  Pick<VideoAssetRecord, 'fileSizeBytes' | 'durationSeconds' | 'width' | 'height' | 'aspectRatio'>
>;

type EnrichedPublishingAssets = {
  images: Map<string, CachedCloudflareImage>;
  videos: Map<string, VideoAssetRecord>;
};

const isVideoRecord = (
  asset: CachedCloudflareImage | VideoAssetRecord
): asset is VideoAssetRecord => 'assetType' in asset && asset.assetType === 'video';

const parsePositiveNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
};

const normalizeRemoteUrl = (value?: string) => {
  const trimmed = value?.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.toString();
  } catch {
    return '';
  }
};

const normalizeLocalPath = (value?: string) => {
  const trimmed = value?.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('file://')) {
    try {
      return fileURLToPath(trimmed);
    } catch {
      return '';
    }
  }
  if (/^[a-zA-Z]+:\/\//.test(trimmed)) return '';
  return trimmed;
};

const dedupeSources = (sources: Array<ResolvedSource | null>): ResolvedSource[] => {
  const seen = new Set<string>();
  const results: ResolvedSource[] = [];
  for (const source of sources) {
    if (!source) continue;
    const key = `${source.kind}:${source.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(source);
  }
  return results;
};

const toRemoteSource = (value?: string): ResolvedSource | null => {
  const normalized = normalizeRemoteUrl(value);
  return normalized ? { kind: 'remote', value: normalized } : null;
};

const toLocalSource = (value?: string): ResolvedSource | null => {
  const normalized = normalizeLocalPath(value);
  return normalized ? { kind: 'local', value: normalized } : null;
};

const parseContentLength = (value: string | null): number | undefined => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const parseContentRangeTotal = (value: string | null): number | undefined => {
  if (!value) return undefined;
  const match = value.match(/\/(\d+)$/);
  if (!match) return undefined;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const fetchRemoteFileSize = async (url: string): Promise<number | undefined> => {
  try {
    const head = await fetch(url, { method: 'HEAD', redirect: 'follow', cache: 'no-store' });
    if (head.ok) {
      const sized = parseContentLength(head.headers.get('content-length'));
      if (sized) return sized;
    }
  } catch {
    // Fall through to the range request.
  }

  try {
    const ranged = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
      headers: { Range: 'bytes=0-0' },
    });
    if (!ranged.ok) return undefined;
    return (
      parseContentRangeTotal(ranged.headers.get('content-range')) ??
      parseContentLength(ranged.headers.get('content-length'))
    );
  } catch {
    return undefined;
  }
};

const getLocalFileSize = async (filePath: string): Promise<number | undefined> => {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile() && stats.size > 0 ? stats.size : undefined;
  } catch {
    return undefined;
  }
};

const getLocalImageMetadata = async (filePath: string) => {
  try {
    const metadata = await sharp(filePath, { failOn: 'none' }).metadata();
    if (!metadata.width || !metadata.height) return null;
    return {
      width: metadata.width,
      height: metadata.height,
      aspectRatio: calculateAspectRatio(metadata.width, metadata.height).common,
    };
  } catch {
    return null;
  }
};

const getRemoteImageMetadata = async (url: string) => {
  try {
    const { width, height } = await fetchImageDimensions(url);
    return {
      width,
      height,
      aspectRatio: calculateAspectRatio(width, height).common,
    };
  } catch {
    return null;
  }
};

const getImageSources = (image: CachedCloudflareImage): ResolvedSource[] =>
  dedupeSources([
    toRemoteSource(image.originalUrl),
    toLocalSource(image.originalUrl),
    toRemoteSource(image.sourceUrl),
    toLocalSource(image.sourceUrl),
    // Image Delivery's small variant preserves the source aspect ratio while
    // keeping the metadata probe substantially smaller than the public asset.
    toRemoteSource(image.variants?.find((value) => value.includes('/small'))),
    toRemoteSource(image.variants?.find((value) => value.includes('/public')) || image.variants?.[0]),
    (() => {
      try {
        return toRemoteSource(getCloudflareImageUrl(image.id, 'public'));
      } catch {
        return null;
      }
    })(),
  ]);

const hasImageDimensions = (image: CachedCloudflareImage) =>
  Boolean(image.dimensions?.width && image.dimensions?.height);

const persistImageAspectMetadata = async (image: CachedCloudflareImage): Promise<void> => {
  const width = image.dimensions?.width;
  const height = image.dimensions?.height;
  if (!width || !height) return;

  try {
    await storeImageAspectMetadata({
      imageId: image.id,
      aspectRatio: image.aspectRatio ?? calculateAspectRatio(width, height).common,
      aspectRatioClass: classifyAspectRatio(width, height),
      width,
      height,
    });
  } catch (error) {
    console.warn('[metadata-enrichment] Failed to persist image aspect metadata', {
      imageId: image.id,
      error,
    });
  }
};

const getVideoSources = (video: VideoAssetRecord): ResolvedSource[] =>
  dedupeSources([
    ...resolveVideoDownloadUrls(video).map((value) => toRemoteSource(value)),
    toRemoteSource(video.originalUrl),
    toLocalSource(video.originalUrl),
    toRemoteSource(video.sourceUrl),
    toLocalSource(video.sourceUrl),
  ]);

const hasImageMetadata = (image: CachedCloudflareImage) =>
  typeof image.size === 'number' &&
  image.size > 0 &&
  Boolean(image.aspectRatio) &&
  hasImageDimensions(image);

const hasImageAspectMetadata = (image: CachedCloudflareImage) =>
  Boolean(image.aspectRatio) && hasImageDimensions(image);

export async function enrichImageAssetMetadata(
  input: string | CachedCloudflareImage,
  options: ImageMetadataEnrichmentOptions = {}
): Promise<CachedCloudflareImage | null> {
  const image = typeof input === 'string' ? await getCachedImage(input) : input;
  if (!image) return null;
  const includeSize = options.includeSize ?? true;
  if ((includeSize && hasImageMetadata(image)) || (!includeSize && hasImageAspectMetadata(image))) {
    await persistImageAspectMetadata(image);
    return image;
  }

  const patch: ImageMetadataPatch = {};
  const sources = getImageSources(image);

  if (includeSize && !(typeof image.size === 'number' && image.size > 0)) {
    for (const source of sources) {
      const size =
        source.kind === 'remote'
          ? await fetchRemoteFileSize(source.value)
          : await getLocalFileSize(source.value);
      if (size) {
        patch.size = size;
        break;
      }
    }
  }

  if (!image.aspectRatio && hasImageDimensions(image)) {
    const { width, height } = image.dimensions!;
    patch.aspectRatio = calculateAspectRatio(width, height).common;
  }

  if (!hasImageDimensions(image)) {
    for (const source of sources) {
      const metadata =
        source.kind === 'remote'
          ? await getRemoteImageMetadata(source.value)
          : await getLocalImageMetadata(source.value);
      if (metadata) {
        patch.aspectRatio = metadata.aspectRatio;
        patch.dimensions = { width: metadata.width, height: metadata.height };
        break;
      }
    }
  }

  if (!Object.keys(patch).length) {
    return image;
  }

  const next = {
    ...image,
    ...patch,
    size: patch.size ?? image.size,
    aspectRatio: patch.aspectRatio ?? image.aspectRatio,
    dimensions: patch.dimensions ?? image.dimensions,
  };
  await upsertCachedImage(next);
  await persistImageAspectMetadata(next);
  return next;
}

export async function enrichVideoAssetMetadata(
  input: string | VideoAssetRecord
): Promise<VideoAssetRecord | null> {
  const initial = typeof input === 'string' ? await getVideoAssetRecord(input) : input;
  if (!initial) return null;

  let video = initial;
  if (
    !(typeof video.durationSeconds === 'number' && video.durationSeconds > 0) ||
    !video.width ||
    !video.height ||
    !video.aspectRatio
  ) {
    video = await syncVideoAssetRecordFromStream(video);
  }

  const patch: VideoMetadataPatch = {};
  const sources = getVideoSources(video);

  if (!(typeof video.fileSizeBytes === 'number' && video.fileSizeBytes > 0)) {
    for (const source of sources) {
      const size =
        source.kind === 'remote'
          ? await fetchRemoteFileSize(source.value)
          : await getLocalFileSize(source.value);
      if (size) {
        patch.fileSizeBytes = size;
        break;
      }
    }
  }

  const needsProbe =
    !(typeof video.durationSeconds === 'number' && video.durationSeconds > 0) ||
    !video.width ||
    !video.height ||
    !video.aspectRatio;
  if (needsProbe) {
    for (const source of sources) {
      try {
        const probe = await probeVideoSource(source.value);
        patch.durationSeconds = parsePositiveNumber(video.durationSeconds) ?? probe.durationSeconds;
        if (probe.width && probe.height) {
          patch.width = probe.width;
          patch.height = probe.height;
          patch.aspectRatio = calculateAspectRatio(probe.width, probe.height).common;
        }
        break;
      } catch {
        continue;
      }
    }
  }

  if (!Object.keys(patch).length) {
    return video;
  }

  return (await updateVideoAssetRecord(video.id, patch)) ?? video;
}

export async function enrichAssetsForPublishing(assetIds: string[]): Promise<EnrichedPublishingAssets> {
  const [images, videos] = await Promise.all([getCachedImages(false), listVideoAssetRecordsWithSync()]);
  const imageMap = new Map(images.map((image) => [image.id, image]));
  const videoMap = new Map(videos.map((video) => [video.id, video]));
  const enrichedImages = new Map<string, CachedCloudflareImage>();
  const enrichedVideos = new Map<string, VideoAssetRecord>();

  for (const assetId of assetIds) {
    const image = imageMap.get(assetId);
    if (image) {
      enrichedImages.set(assetId, (await enrichImageAssetMetadata(image)) ?? image);
      continue;
    }
    const video = videoMap.get(assetId);
    if (video) {
      enrichedVideos.set(assetId, (await enrichVideoAssetMetadata(video)) ?? video);
    }
  }

  return { images: enrichedImages, videos: enrichedVideos };
}

export const getMissingPublishMetadataReasons = (asset: CachedCloudflareImage | VideoAssetRecord): string[] => {
  const reasons: string[] = [];
  if (isVideoRecord(asset)) {
    if (!(typeof asset.fileSizeBytes === 'number' && asset.fileSizeBytes > 0)) reasons.push('size');
    if (!(typeof asset.durationSeconds === 'number' && asset.durationSeconds > 0)) reasons.push('runtime');
    if (!(asset.aspectRatio || (asset.width && asset.height))) reasons.push('ratio');
    return reasons;
  }

  if (!(typeof asset.size === 'number' && asset.size > 0)) reasons.push('size');
  if (!(asset.aspectRatio || (asset.dimensions?.width && asset.dimensions?.height))) reasons.push('ratio');
  return reasons;
};
