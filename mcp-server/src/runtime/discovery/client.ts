import { apiRequest, apiRequestRaw } from '../shared/api-client.js';
import { formatImageResult } from '../shared/image-result.js';
import { getPromptRecord } from '../ai/client.js';
import { getExtras } from '../organization/client.js';
import type { ImageResult, SearchResult } from '../types.js';

export async function semanticSearch(
  query: string,
  limit: number = 20,
  namespace?: string | null
): Promise<SearchResult> {
  const data = await apiRequest<{ results: ImageResult[] }>('/api/images/search', {
    method: 'POST',
    body: JSON.stringify({ type: 'text', query, limit, namespace }),
  });

  return {
    results: data.results.map(formatImageResult),
    query,
    count: data.results.length,
  };
}

// Traditional text search - matches filename, folder, tags, description, alt text
export async function textSearch(
  query: string,
  options: {
    folder?: string;
    namespace?: string;
    limit?: number;
    refresh?: boolean;
  } = {}
): Promise<SearchResult> {
  const data = await metadataSearch(query, {
    folder: options.folder,
    namespace: options.namespace,
    limit: options.limit ?? 50,
  });
  return {
    results: data.results.map(formatImageResult),
    query,
    count: data.count,
  };
}

// Field-aware metadata search - target specific fields with selectable match modes
export type MetadataSearchField =
  | 'filename'
  | 'folder'
  | 'tags'
  | 'description'
  | 'altText'
  | 'namespace'
  | 'sourceUrl'
  | 'originalUrl';

export type MetadataMatchMode = 'contains' | 'exact' | 'prefix' | 'regex';

export const METADATA_SEARCH_FIELDS: MetadataSearchField[] = [
  'filename',
  'folder',
  'tags',
  'description',
  'altText',
  'namespace',
  'sourceUrl',
  'originalUrl',
];

export interface MetadataSearchResult {
  results: Array<ImageResult & { matchedFields: MetadataSearchField[] }>;
  query: string;
  count: number;
  fields: MetadataSearchField[];
  match: MetadataMatchMode;
}

export async function metadataSearch(
  query: string,
  options: {
    fields?: MetadataSearchField[];
    match?: MetadataMatchMode;
    caseSensitive?: boolean;
    folder?: string;
    namespace?: string;
    limit?: number;
    refresh?: boolean;
  } = {}
): Promise<MetadataSearchResult> {
  const match = options.match ?? 'contains';
  const caseSensitive = options.caseSensitive ?? false;
  const requested = options.fields?.length ? options.fields : METADATA_SEARCH_FIELDS;
  // Preserve a stable field order and drop anything unrecognized; fall back to all fields.
  const resolved = METADATA_SEARCH_FIELDS.filter((field) => requested.includes(field));
  const fields = resolved.length ? resolved : METADATA_SEARCH_FIELDS;

  return apiRequest<MetadataSearchResult>('/api/images/metadata-search', {
    method: 'POST',
    body: JSON.stringify({
      query,
      fields,
      match,
      caseSensitive,
      folder: options.folder,
      namespace: options.namespace,
      limit: options.limit ?? 50,
    }),
  });
}

export async function searchByColor(
  hexColor: string,
  limit: number = 20,
  namespace?: string | null
): Promise<SearchResult> {
  // Normalize hex color
  const color = hexColor.startsWith('#') ? hexColor : `#${hexColor}`;
  
  const data = await apiRequest<{ results: ImageResult[] }>('/api/images/search', {
    method: 'POST',
    body: JSON.stringify({ type: 'color', query: color, limit, namespace }),
  });

  return {
    results: data.results.map(formatImageResult),
    query: color,
    count: data.results.length,
  };
}

export async function findSimilar(
  imageId: string,
  type: 'clip' | 'color' = 'clip',
  limit: number = 10,
  options: {
    includeStrangers?: boolean;
    offset?: number;
    strangersLimit?: number;
    strangersOffset?: number;
    namespace?: string | null;
  } = {}
): Promise<SearchResult> {
  const params = new URLSearchParams({ type, limit: String(limit) });
  if (options.includeStrangers) params.set('includeStrangers', 'true');
  if (options.offset !== undefined) params.set('offset', String(options.offset));
  if (options.strangersLimit !== undefined) params.set('strangersLimit', String(options.strangersLimit));
  if (options.strangersOffset !== undefined) params.set('strangersOffset', String(options.strangersOffset));
  if (options.namespace !== undefined) params.set('namespace', String(options.namespace));
  const data = await apiRequest<{ results: ImageResult[]; strangers?: ImageResult[] }>(
    `/api/images/${imageId}/similar?${params}`
  );

  const strangers = data.strangers?.map(formatImageResult);
  return {
    results: data.results.map(formatImageResult),
    query: `similar to ${imageId}`,
    count: data.results.length,
    strangers,
    strangersCount: strangers?.length,
  };
}

export async function listImages(options: {
  folder?: string;
  namespace?: string;
  limit?: number;
  refresh?: boolean;
  aspectRatioClass?: string;
  aspectRatio?: string;
}): Promise<{ images: ImageResult[]; total: number }> {
  const params = new URLSearchParams();
  if (options.namespace) params.set('namespace', options.namespace);
  if (options.refresh) params.set('refresh', '1');
  if (options.aspectRatioClass) params.set('aspectRatioClass', options.aspectRatioClass);
  if (options.aspectRatio) params.set('aspectRatio', options.aspectRatio);

  const data = await apiRequest<{ images: ImageResult[] }>(`/api/images?${params}`);
  
  let images = data.images;
  
  // Filter by folder if specified
  if (options.folder) {
    images = images.filter((img) => img.meta?.folder === options.folder);
  }

  // Apply limit
  const limit = options.limit ?? 50;
  const limited = limit > 0 ? images.slice(0, limit) : images;

  return {
    images: limited.map(formatImageResult),
    total: images.length,
  };
}

function _toRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function _pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return undefined;
}

function _pickNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function _normalizeDimensions(value: unknown): { width: number; height: number } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const obj = value as Record<string, unknown>;
  const width = _pickNumber(obj.width, obj.w);
  const height = _pickNumber(obj.height, obj.h);
  if (width && height) {
    return { width, height };
  }
  return undefined;
}

function _deriveAspectRatio(dimensions?: { width: number; height: number }): string | undefined {
  if (!dimensions) return undefined;
  const { width, height } = dimensions;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined;
  }
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(Math.round(width), Math.round(height));
  if (!g) return undefined;
  return `${Math.round(width / g)}:${Math.round(height / g)}`;
}

function _formatFileSize(bytes?: number): string | undefined {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return undefined;
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded = value >= 10 ? value.toFixed(1) : value.toFixed(2);
  return `${rounded} ${units[unitIndex]}`;
}

export async function getImage(imageId: string): Promise<Record<string, unknown> | null> {
  try {
    const data = await apiRequest<{ image: Record<string, unknown> }>(`/api/images/${imageId}`);
    const rawImage = data.image;
    const normalized = formatImageResult(rawImage as unknown as ImageResult);
    const metadata = _toRecord(rawImage.meta);
    const dimensions =
      normalized.dimensions
      || _normalizeDimensions(rawImage.dimensions)
      || _normalizeDimensions(metadata.dimensions)
      || (() => {
        const width = _pickNumber(rawImage.width, metadata.width);
        const height = _pickNumber(rawImage.height, metadata.height);
        return width && height ? { width, height } : undefined;
      })();
    const aspectRatio =
      _pickString(
        normalized.aspectRatio,
        rawImage.aspectRatio,
        metadata.aspectRatio
      ) || _deriveAspectRatio(dimensions);
    const fileSizeBytes = _pickNumber(
      rawImage.size,
      (rawImage as Record<string, unknown>).fileSize,
      rawImage.bytes,
      metadata.size,
      (metadata as Record<string, unknown>).fileSize,
      metadata.bytes
    );
    const contentType = _pickString(
      rawImage.type,
      (rawImage as Record<string, unknown>).contentType,
      (rawImage as Record<string, unknown>).mimeType,
      metadata.type,
      (metadata as Record<string, unknown>).contentType,
      (metadata as Record<string, unknown>).mimeType
    );

    return {
      ...normalized,
      uploadedAt:
        _pickString(
          (rawImage as Record<string, unknown>).uploaded,
          (rawImage as Record<string, unknown>).uploadedAt,
          (rawImage as Record<string, unknown>).createdAt,
          (rawImage as Record<string, unknown>).updatedAt,
          metadata.uploadedAt,
          metadata.updatedAt
        ) || null,
      folder: normalized.folder || _pickString(metadata.folder) || null,
      tags: normalized.tags || (Array.isArray(metadata.tags) ? metadata.tags : []),
      displayName:
        _pickString(
          (rawImage as Record<string, unknown>).displayName,
          metadata.displayName
        ) || null,
      linkedAssetId:
        _pickString(
          (rawImage as Record<string, unknown>).linkedAssetId,
          metadata.linkedAssetId
        ) || null,
      variationSort: _pickNumber(
        (rawImage as Record<string, unknown>).variationSort,
        metadata.variationSort
      ) ?? null,
      generatedBy:
        _pickString(
          (rawImage as Record<string, unknown>).generatedBy,
          metadata.generatedBy
        ) || null,
      contentHash:
        _pickString(
          (rawImage as Record<string, unknown>).contentHash,
          metadata.contentHash
        ) || null,
      fileSizeBytes: fileSizeBytes ?? null,
      fileSize: _formatFileSize(fileSizeBytes) || null,
      contentType: contentType || null,
      dimensions: dimensions || null,
      aspectRatio: aspectRatio || null,
      metadata,
      raw: rawImage,
    };
  } catch {
    return null;
  }
}

export async function getImageMetadata(imageId: string): Promise<Record<string, unknown> | null> {
  let rawImage: Record<string, unknown>;
  try {
    const data = await apiRequest<{ image: Record<string, unknown> }>(`/api/images/${imageId}`);
    rawImage = data.image;
  } catch {
    return null;
  }

  const normalized = formatImageResult(rawImage as unknown as ImageResult);
  const isVariant = Boolean(normalized.parentId);
  const familyRootId = isVariant ? normalized.parentId : normalized.id;

  let familyVariantCount: number | null = null;
  try {
    const { images } = await listImages({ limit: 0 });
    familyVariantCount = images.filter((img) => (img.parentId || null) === familyRootId).length;
  } catch {
    familyVariantCount = null;
  }

  let extrasRecord: { description?: string; altText?: string } | null = null;
  try {
    const extras = await getExtras(imageId);
    extrasRecord = extras.record;
  } catch {
    extrasRecord = null;
  }

  let promptText: string | null = null;
  try {
    const promptResult = await getPromptRecord(imageId);
    const record = (promptResult.record || {}) as Record<string, unknown>;
    const candidate = record.prompt;
    promptText = typeof candidate === 'string' ? candidate : null;
  } catch {
    promptText = null;
  }

  const tags = normalized.tags || [];
  const variants = normalized.variants;
  const variantUrls = Array.isArray(variants)
    ? variants
    : variants && typeof variants === 'object'
      ? Object.values(variants)
      : [];

  return {
    id: normalized.id,
    filename: normalized.filename,
    url: normalized.url,
    uploadedAt:
      (rawImage.createdAt as string | undefined)
      || (rawImage.uploaded as string | undefined)
      || (rawImage.uploadedAt as string | undefined)
      || (rawImage.updatedAt as string | undefined)
      || null,
    folder: normalized.folder || null,
    namespace: normalized.namespace || null,
    tags,
    description: normalized.description || null,
    altDescription: extrasRecord?.altText || normalized.altTag || null,
    prompt: promptText,
    isVariant,
    parentId: normalized.parentId || null,
    familyRootId,
    variantCount: familyVariantCount,
    variantUrls,
    dimensions: normalized.dimensions || null,
    aspectRatio: normalized.aspectRatio || null,
    dominantColors: normalized.dominantColors || null,
    averageColor: normalized.averageColor || null,
    hasClipEmbedding: normalized.hasClipEmbedding ?? null,
    hasColorEmbedding: normalized.hasColorEmbedding ?? null,
    originalUrl: normalized.originalUrl || null,
    sourceUrl: normalized.sourceUrl || null,
    extras: extrasRecord,
    raw: rawImage,
  };
}

export async function findAntipode(
  imageId: string,
  options: {
    domain?: 'clip' | 'color';
    method?: string;
    limit?: number;
    namespace?: string | null;
  } = {}
): Promise<SearchResult> {
  const params = new URLSearchParams();
  if (options.domain) params.set('domain', options.domain);
  if (options.method) params.set('method', options.method);
  if (options.limit) params.set('limit', String(options.limit));
  if (options.namespace !== undefined) params.set('namespace', String(options.namespace));

  const data = await apiRequest<{ results: ImageResult[] }>(
    `/api/images/${imageId}/antipode?${params}`
  );

  return {
    results: data.results.map(formatImageResult),
    query: `antipode of ${imageId}`,
    count: data.results.length,
  };
}

export async function searchByImage(imageId: string, limit: number = 20, namespace?: string | null): Promise<SearchResult> {
  const data = await apiRequest<{ results: ImageResult[]; count: number }>('/api/images/search', {
    method: 'POST',
    body: JSON.stringify({ type: 'image', imageId, limit, namespace }),
  });

  return {
    results: data.results.map(formatImageResult),
    query: `image:${imageId}`,
    count: data.results.length,
  };
}

export async function downloadImageById(
  imageId: string,
  variant?: string
): Promise<{
  filename?: string;
  contentType?: string;
  size?: number;
  base64: string;
  requestedVariant?: string;
  servedVariant?: string;
}> {
  const params = new URLSearchParams();
  if (variant) params.set('variant', variant);
  const response = await apiRequestRaw(`/api/images/${imageId}/download${params.toString() ? `?${params}` : ''}`, { method: 'GET' });
  const contentType = response.headers.get('content-type') || undefined;
  const disposition = response.headers.get('content-disposition') || undefined;
  const sizeHeader = response.headers.get('content-length') || undefined;
  const requestedVariant = response.headers.get('x-photarium-variant-requested') || undefined;
  const servedVariant = response.headers.get('x-photarium-variant-served') || undefined;
  const arrayBuffer = await response.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString('base64');
  const filenameMatch = disposition?.match(/filename="?([^";]+)"?/i);
  return {
    filename: filenameMatch?.[1],
    contentType,
    size: sizeHeader ? Number(sizeHeader) : undefined,
    base64,
    requestedVariant,
    servedVariant,
  };
}

export async function downloadOriginalImageById(imageId: string): Promise<{
  filename?: string;
  contentType?: string;
  size?: number;
  base64: string;
  variantUsed: string;
  fallbackUsed: boolean;
  fallbackReason?: string;
}> {
  try {
    const result = await downloadImageById(imageId, 'original');
    return {
      ...result,
      variantUsed: 'original',
      fallbackUsed: false,
    };
  } catch (error) {
    const fallback = await downloadImageById(imageId);
    return {
      ...fallback,
      variantUsed: 'default',
      fallbackUsed: true,
      fallbackReason: error instanceof Error ? error.message : String(error),
    };
  }
}
