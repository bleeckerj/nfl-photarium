export type CloudflareMetadata = {
  folder?: string;
  tags?: string[];
  description?: string;
  size?: number | string;
  aspectRatio?: string;
  aspectRatioClass?: string;
  dimensions?: {
    width?: number;
    height?: number;
  };
  bytes?: number | string;
  fileSize?: number | string;
  type?: string;
  contentType?: string;
  mimeType?: string;
  originalUrl?: string;
  originalUrlNormalized?: string;
  sourceUrl?: string;
  sourceUrlNormalized?: string;
  sourcePath?: string;
  namespace?: string;
  contentHash?: string;
  altTag?: string;
  displayName?: string;
  filename?: string;
  variationParentId?: string;
  duplicateFamilyOverride?: boolean;
  duplicateDetectionOverride?: boolean;
  linkedAssetId?: string;
  exif?: Record<string, string | number>;
  generatedBy?: string;
  comfyMetadataDetected?: boolean;
  comfyMetadataSource?: string;
  uploadNormalization?: {
    reasons?: string[];
    originalBytes?: number;
    finalBytes?: number;
    maxBytes?: number;
    maxDimension?: number;
    maxArea?: number;
    originalType?: string;
    finalType?: string;
    originalWidth?: number;
    originalHeight?: number;
    finalWidth?: number;
    finalHeight?: number;
  };
  uploadedAt?: string;
  updatedAt?: string;
  variationSort?: number;
  [key: string]: unknown;
};

export const CLOUDFLARE_METADATA_FIELDS = [
  'folder',
  'tags',
  'description',
  'originalUrl',
  'originalUrlNormalized',
  'sourceUrl',
  'sourceUrlNormalized',
  'sourcePath',
  'namespace',
  'contentHash',
  'altTag',
  'displayName',
  'variationParentId',
  'duplicateFamilyOverride',
  'duplicateDetectionOverride',
  'linkedAssetId',
  'exif',
  'generatedBy',
  'comfyMetadataDetected',
  'comfyMetadataSource',
  'uploadNormalization',
  'variationSort',
  'size',
  'aspectRatio',
  'aspectRatioClass',
  'dimensions',
  'updatedAt'
] as const;

export const CLOUDFLARE_EXTRAS_ONLY_FIELDS = [
  'folder',
  'description',
  'originalUrl',
  'originalUrlNormalized',
  'sourceUrl',
  'sourceUrlNormalized',
  'exif',
] as const;

type CloudflareMetadataField = typeof CLOUDFLARE_METADATA_FIELDS[number];
type CloudflareExtrasOnlyField = typeof CLOUDFLARE_EXTRAS_ONLY_FIELDS[number];

/**
 * Check if a value is "empty" and should be excluded from metadata.
 * Empty values: undefined, null, '', [], {}
 */
function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') {
    return true;
  }
  if (Array.isArray(value) && value.length === 0) {
    return true;
  }
  if (typeof value === 'object' && value !== null && Object.keys(value).length === 0) {
    return true;
  }
  return false;
}

export function pickCloudflareMetadata(
  meta: Record<string, unknown>,
  options?: {
    /**
     * When true, include empty values ('' / [] / {}) in the payload.
     * This is useful for PATCH semantics where omitting a key does not clear it.
     */
    includeEmpty?: boolean;
  }
): CloudflareMetadata {
  const includeEmpty = options?.includeEmpty ?? false;
  const trimmed: Record<string, unknown> = {};
  CLOUDFLARE_METADATA_FIELDS.forEach((key) => {
    const value = meta[key as CloudflareMetadataField];
    if (value === undefined || value === null) {
      return;
    }
    // Exclude empty values by default to reduce byte count.
    if (!includeEmpty && isEmptyValue(value)) {
      return;
    }
    if (includeEmpty || !isEmptyValue(value)) {
      trimmed[key] = value;
    }
  });
  return trimmed as CloudflareMetadata;
}

export function omitExtrasOnlyCloudflareMetadata(meta: Record<string, unknown>) {
  const trimmed = { ...meta };
  CLOUDFLARE_EXTRAS_ONLY_FIELDS.forEach((key) => {
    delete trimmed[key as CloudflareExtrasOnlyField];
  });
  return trimmed;
}

/**
 * Parse the metadata returned by Cloudflare as JSON or object.
 */
export function parseCloudflareMetadata(rawMeta?: unknown): CloudflareMetadata {
  if (!rawMeta) {
    return {};
  }

  if (typeof rawMeta === 'string') {
    try {
      const parsed = JSON.parse(rawMeta);
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed as CloudflareMetadata;
      }
      return {};
    } catch (err) {
      console.warn('Failed to parse Cloudflare metadata as JSON:', err);
      return {};
    }
  }

  if (typeof rawMeta === 'object' && rawMeta !== null) {
    return rawMeta as CloudflareMetadata;
  }

  return {};
}

/**
 * Normalize a string value coming from the client/backing metadata.
 */
export function cleanString(value?: string | null): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === 'undefined') {
    return undefined;
  }

  return trimmed;
}

const getMetadataByteSize = (payload: Record<string, unknown>) =>
  Buffer.byteLength(JSON.stringify(payload), 'utf8');

export function enforceCloudflareMetadataLimit(
  payload: Record<string, unknown>,
  limitBytes = 1024
) {
  const trimmed = { ...payload };
  let size = getMetadataByteSize(trimmed);
  const dropped: string[] = [];
  const dropOrder = [
    'exif',
    'originalUrlNormalized',
    'sourceUrlNormalized',
    'displayName',
    'filename',
    'contentHash',
    'generatedBy',
    'comfyMetadataDetected',
    'comfyMetadataSource',
    'uploadNormalization',
    'uploadedAt',
    'type',
    'size',
    'variationParentId',
    'duplicateFamilyOverride',
    'duplicateDetectionOverride',
    'linkedAssetId',
    'variationSort',
    'description',
    'tags',
    'originalUrl',
    'sourceUrl',
    'sourcePath',
    'namespace',
    'folder'
  ];

  for (const key of dropOrder) {
    if (size <= limitBytes) break;
    if (Object.prototype.hasOwnProperty.call(trimmed, key)) {
      delete trimmed[key];
      dropped.push(key);
      size = getMetadataByteSize(trimmed);
    }
  }

  if (size > limitBytes) {
    const stringKeys = Object.keys(trimmed).filter(
      (key) => typeof trimmed[key] === 'string'
    );
    stringKeys.sort(
      (a, b) => String(trimmed[b]).length - String(trimmed[a]).length
    );
    for (const key of stringKeys) {
      if (size <= limitBytes) break;
      delete trimmed[key];
      dropped.push(key);
      size = getMetadataByteSize(trimmed);
    }
  }

  return { metadata: trimmed, dropped, size, limitBytes };
}
