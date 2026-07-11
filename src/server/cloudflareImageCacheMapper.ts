import { cleanString, parseCloudflareMetadata, type CloudflareMetadata } from '@/utils/cloudflareMetadata';
import { normalizeAspectRatioClass, type AspectRatioClass } from '@/utils/aspectRatioClass';
import { normalizeOriginalUrl } from '@/utils/urlNormalization';
import type { AnimatedWebpProvenanceRecord } from '@/server/imageExtras';

export interface CloudflareImageApiResponse {
  id: string;
  filename?: string;
  uploaded: string;
  variants: string[];
  size?: number;
  meta?: unknown;
}

export interface CachedCloudflareImage {
  id: string;
  filename: string;
  uploaded: string;
  variants: string[];
  size?: number;
  contentType?: string;
  isAnimated?: boolean;
  animatedWebp?: AnimatedWebpProvenanceRecord;
  folder?: string;
  tags: string[];
  description?: string;
  originalUrl?: string;
  originalUrlNormalized?: string;
  sourceUrl?: string;
  sourceUrlNormalized?: string;
  namespace?: string;
  contentHash?: string;
  altTag?: string;
  displayName?: string;
  exif?: Record<string, string | number>;
  generatedBy?: string;
  comfyMetadataDetected?: boolean;
  comfyMetadataSource?: string;
  parentId?: string;
  duplicateFamilyOverride?: boolean;
  duplicateDetectionOverride?: boolean;
  linkedAssetId?: string;
  variationSort?: number;
  hasClipEmbedding?: boolean;
  hasColorEmbedding?: boolean;
  dominantColors?: string[];
  averageColor?: string;
  aspectRatio?: string;
  aspectRatioClass?: AspectRatioClass;
  dimensions?: { width: number; height: number };
  rotatedFromId?: string;
  rotatedAt?: string;
  rotationDegrees?: number;
}

export const buildMetadataOverride = (
  image: CachedCloudflareImage,
  options?: { clearFolder?: boolean; clearParentId?: boolean }
): CloudflareMetadata => {
  const override: CloudflareMetadata = {};
  const assign = <K extends keyof CloudflareMetadata>(key: K, value: CloudflareMetadata[K]) => {
    if (value !== undefined) {
      override[key] = value;
    }
  };
  assign('folder', options?.clearFolder ? '' : image.folder);
  assign('tags', image.tags);
  assign('description', image.description);
  assign('originalUrl', image.originalUrl);
  assign('originalUrlNormalized', image.originalUrlNormalized);
  assign('sourceUrl', image.sourceUrl);
  assign('sourceUrlNormalized', image.sourceUrlNormalized);
  assign('namespace', image.namespace);
  assign('contentHash', image.contentHash);
  assign('altTag', image.altTag);
  assign('displayName', image.displayName);
  assign('generatedBy', image.generatedBy);
  assign('comfyMetadataDetected', image.comfyMetadataDetected);
  assign('comfyMetadataSource', image.comfyMetadataSource);
  assign('variationParentId', options?.clearParentId ? '' : image.parentId);
  assign('duplicateFamilyOverride', image.duplicateFamilyOverride);
  assign('duplicateDetectionOverride', image.duplicateDetectionOverride);
  assign('linkedAssetId', image.linkedAssetId);
  assign('variationSort', image.variationSort);
  assign('size', image.size);
  assign('aspectRatio', image.aspectRatio);
  assign('aspectRatioClass', image.aspectRatioClass);
  assign('dimensions', image.dimensions);
  assign('type', image.contentType);
  assign('isAnimated', image.isAnimated);
  assign('rotatedFromId', image.rotatedFromId);
  assign('rotatedAt', image.rotatedAt);
  assign('rotationDegrees', image.rotationDegrees);
  return override;
};

const mergeMetadata = (base: CloudflareMetadata, override?: CloudflareMetadata) => {
  if (!override) return base;
  const merged = { ...base } as CloudflareMetadata;
  Object.entries(override).forEach(([key, value]) => {
    if (key === 'folder') {
      merged.folder = typeof value === 'string' ? value : undefined;
      return;
    }
    if (key === 'variationParentId') {
      merged.variationParentId = typeof value === 'string' ? value : undefined;
      return;
    }
    if (merged[key as keyof CloudflareMetadata] === undefined && value !== undefined) {
      merged[key as keyof CloudflareMetadata] = value as CloudflareMetadata[keyof CloudflareMetadata];
    }
  });
  return merged;
};

export const transformImage = (
  image: CloudflareImageApiResponse,
  overrideMeta?: CloudflareMetadata
): CachedCloudflareImage => {
  const parsedMeta = parseCloudflareMetadata(image.meta);
  const mergedMeta = mergeMetadata(parsedMeta, overrideMeta);
  const cleanFolder =
    mergedMeta.folder && mergedMeta.folder !== 'undefined' ? mergedMeta.folder : undefined;
  const cleanTags = Array.isArray(mergedMeta.tags)
    ? mergedMeta.tags.filter((tag): tag is string => Boolean(tag) && tag !== 'undefined')
    : [];
  const cleanDescription =
    mergedMeta.description && mergedMeta.description !== 'undefined'
      ? mergedMeta.description
      : undefined;
  const cleanOriginalUrl =
    mergedMeta.originalUrl && mergedMeta.originalUrl !== 'undefined'
      ? mergedMeta.originalUrl
      : undefined;
  const cleanOriginalUrlNormalized =
    mergedMeta.originalUrlNormalized && mergedMeta.originalUrlNormalized !== 'undefined'
      ? mergedMeta.originalUrlNormalized
      : undefined;
  const normalizedOriginalUrl =
    cleanOriginalUrlNormalized ?? normalizeOriginalUrl(cleanOriginalUrl);
  const cleanSourceUrl =
    mergedMeta.sourceUrl && mergedMeta.sourceUrl !== 'undefined'
      ? mergedMeta.sourceUrl
      : undefined;
  const cleanSourceUrlNormalized =
    mergedMeta.sourceUrlNormalized && mergedMeta.sourceUrlNormalized !== 'undefined'
      ? mergedMeta.sourceUrlNormalized
      : undefined;
  const normalizedSourceUrl =
    cleanSourceUrlNormalized ?? normalizeOriginalUrl(cleanSourceUrl);
  const cleanNamespace =
    mergedMeta.namespace && mergedMeta.namespace !== 'undefined'
      ? mergedMeta.namespace
      : undefined;
  const cleanAltTag =
    mergedMeta.altTag && mergedMeta.altTag !== 'undefined' ? mergedMeta.altTag : undefined;
  const displayName =
    mergedMeta.displayName && mergedMeta.displayName !== 'undefined'
      ? mergedMeta.displayName
      : undefined;
  const cleanContentHash =
    mergedMeta.contentHash && mergedMeta.contentHash !== 'undefined'
      ? mergedMeta.contentHash
      : undefined;
  const cleanExif =
    mergedMeta.exif && typeof mergedMeta.exif === 'object' && !Array.isArray(mergedMeta.exif)
      ? (mergedMeta.exif as Record<string, string | number>)
      : undefined;
  const cleanGeneratedBy =
    mergedMeta.generatedBy && mergedMeta.generatedBy !== 'undefined'
      ? String(mergedMeta.generatedBy)
      : undefined;
  const comfyMetadataDetected =
    mergedMeta.comfyMetadataDetected === true || cleanGeneratedBy === 'comfyui'
      ? true
      : undefined;
  const comfyMetadataSource =
    mergedMeta.comfyMetadataSource && mergedMeta.comfyMetadataSource !== 'undefined'
      ? String(mergedMeta.comfyMetadataSource)
      : undefined;
  const duplicateFamilyOverride = mergedMeta.duplicateFamilyOverride === true;
  const duplicateDetectionOverride = mergedMeta.duplicateDetectionOverride === true;
  const cleanVariationSort = (() => {
    if (typeof mergedMeta.variationSort === 'number' && Number.isFinite(mergedMeta.variationSort)) {
      return mergedMeta.variationSort;
    }
    if (typeof mergedMeta.variationSort === 'string') {
      const parsed = Number(mergedMeta.variationSort);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  })();
  const parentId = cleanString(mergedMeta.variationParentId);
  const linkedAssetId = cleanString(mergedMeta.linkedAssetId);
  const parsedSize = (() => {
    const candidates = [mergedMeta.size, mergedMeta.bytes, mergedMeta.fileSize, image.size];
    for (const candidate of candidates) {
      if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0) {
        return candidate;
      }
      if (typeof candidate === 'string') {
        const parsed = Number(candidate);
        if (Number.isFinite(parsed) && parsed >= 0) {
          return parsed;
        }
      }
    }
    return undefined;
  })();
  const contentType = (() => {
    const candidates = [mergedMeta.type, mergedMeta.contentType, mergedMeta.mimeType];
    for (const candidate of candidates) {
      if (typeof candidate === 'string') {
        const trimmed = candidate.trim();
        if (trimmed) return trimmed;
      }
    }
    return undefined;
  })();
  const isAnimated = mergedMeta.isAnimated === true ? true : undefined;
  const parsedDimensions = (() => {
    const rawDimensions = mergedMeta.dimensions;
    if (!rawDimensions || typeof rawDimensions !== 'object') {
      return undefined;
    }
    const typed = rawDimensions as { width?: unknown; height?: unknown };
    const width =
      typeof typed.width === 'number'
        ? typed.width
        : typeof typed.width === 'string'
          ? Number(typed.width)
          : undefined;
    const height =
      typeof typed.height === 'number'
        ? typed.height
        : typeof typed.height === 'string'
          ? Number(typed.height)
          : undefined;
    return width && height && Number.isFinite(width) && Number.isFinite(height)
      ? { width, height }
      : undefined;
  })();
  const parsedAspectRatio = (() => {
    if (typeof mergedMeta.aspectRatio !== 'string') {
      return undefined;
    }
    const trimmed = mergedMeta.aspectRatio.trim();
    return trimmed ? trimmed : undefined;
  })();
  const parsedAspectRatioClass = normalizeAspectRatioClass(
    typeof mergedMeta.aspectRatioClass === 'string' ? mergedMeta.aspectRatioClass : undefined
  );

  return {
    id: image.id,
    filename: image.filename || parsedMeta.filename || 'Unknown',
    uploaded: image.uploaded,
    variants: image.variants,
    size: parsedSize,
    contentType,
    isAnimated,
    folder: cleanFolder,
    tags: cleanTags,
    description: cleanDescription,
    originalUrl: cleanOriginalUrl,
    originalUrlNormalized: normalizedOriginalUrl,
    sourceUrl: cleanSourceUrl,
    sourceUrlNormalized: normalizedSourceUrl,
    namespace: cleanNamespace,
    contentHash: cleanContentHash,
    altTag: cleanAltTag,
    displayName: displayName ?? (image.filename || parsedMeta.filename || undefined),
    exif: cleanExif,
    generatedBy: cleanGeneratedBy,
    comfyMetadataDetected,
    comfyMetadataSource,
    duplicateFamilyOverride: duplicateFamilyOverride || undefined,
    duplicateDetectionOverride: duplicateDetectionOverride || undefined,
    variationSort: cleanVariationSort,
    parentId,
    linkedAssetId,
    aspectRatio: parsedAspectRatio,
    aspectRatioClass: parsedAspectRatioClass ?? undefined,
    dimensions: parsedDimensions,
    rotatedFromId: cleanString(mergedMeta.rotatedFromId as string | undefined),
    rotatedAt: cleanString(mergedMeta.rotatedAt as string | undefined),
    rotationDegrees: typeof mergedMeta.rotationDegrees === 'number'
      ? mergedMeta.rotationDegrees
      : undefined,
  };
};
