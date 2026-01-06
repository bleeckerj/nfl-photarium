export type CloudflareMetadata = {
  folder?: string;
  tags?: string[];
  description?: string;
  originalUrl?: string;
  originalUrlNormalized?: string;
  contentHash?: string;
  altTag?: string;
  displayName?: string;
  filename?: string;
  variationParentId?: string;
  linkedAssetId?: string;
  exif?: Record<string, string | number>;
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
  'contentHash',
  'altTag',
  'displayName',
  'variationParentId',
  'linkedAssetId',
  'exif',
  'variationSort',
  'updatedAt'
] as const;

type CloudflareMetadataField = typeof CLOUDFLARE_METADATA_FIELDS[number];

export function pickCloudflareMetadata(
  meta: Record<string, unknown>
): CloudflareMetadata {
  const trimmed: Record<string, unknown> = {};
  CLOUDFLARE_METADATA_FIELDS.forEach((key) => {
    const value = meta[key as CloudflareMetadataField];
    if (value !== undefined) {
      trimmed[key] = value;
    }
  });
  return trimmed as CloudflareMetadata;
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
  let trimmed = { ...payload };
  let size = getMetadataByteSize(trimmed);
  const dropped: string[] = [];
  const dropOrder = [
    'exif',
    'description',
    'tags',
    'originalUrlNormalized',
    'originalUrl',
    'folder',
    'displayName',
    'filename',
    'contentHash',
    'uploadedAt',
    'type',
    'size',
    'variationParentId',
    'linkedAssetId',
    'variationSort'
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

  return { metadata: trimmed, dropped };
}
