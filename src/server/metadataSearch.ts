import { getCachedImages, type CachedCloudflareImage } from '@/server/cloudflareImageCache';
import { getImageExtrasRecords, type ImageExtrasRecord } from '@/server/imageExtras';
import { queryMetadataIndex } from '@/server/metadataSearchIndex';

export const METADATA_SEARCH_FIELDS = [
  'filename',
  'folder',
  'tags',
  'description',
  'altText',
  'namespace',
  'sourceUrl',
  'originalUrl',
] as const;

export type MetadataSearchField = (typeof METADATA_SEARCH_FIELDS)[number];
export type MetadataMatchMode = 'contains' | 'exact' | 'prefix' | 'regex';

export type MetadataSearchRequest = {
  query: string;
  fields?: MetadataSearchField[];
  match?: MetadataMatchMode;
  caseSensitive?: boolean;
  folder?: string;
  namespace?: string;
  limit?: number;
};

export type MetadataSearchImage = CachedCloudflareImage & {
  altText?: string;
  matchedFields: MetadataSearchField[];
};

export type MetadataSearchResponse = {
  results: MetadataSearchImage[];
  query: string;
  count: number;
  fields: MetadataSearchField[];
  match: MetadataMatchMode;
  diagnostics?: {
    backend: 'redis-index' | 'server-scan';
    candidateCount: number;
    fallbackReason?: string;
    indexVersion?: string;
    elapsedMs: number;
  };
};

const hasOwn = (record: object, key: string) => Object.prototype.hasOwnProperty.call(record, key);

function mergeExtras(image: CachedCloudflareImage, extras: ImageExtrasRecord | null): CachedCloudflareImage & { altText?: string } {
  if (!extras) return image;
  return {
    ...image,
    folder: hasOwn(extras, 'folder') ? extras.folder : image.folder,
    description: extras.description ?? image.description,
    altTag: extras.altText ?? image.altTag,
    altText: extras.altText,
    sourceUrl: extras.sourceUrl ?? image.sourceUrl,
    sourceUrlNormalized: extras.sourceUrlNormalized ?? image.sourceUrlNormalized,
    originalUrl: extras.originalUrl ?? image.originalUrl,
    originalUrlNormalized: extras.originalUrlNormalized ?? image.originalUrlNormalized,
  };
}

function fieldValues(image: CachedCloudflareImage & { altText?: string }, field: MetadataSearchField): string[] {
  switch (field) {
    case 'filename': return image.filename ? [image.filename] : [];
    case 'folder': return image.folder ? [image.folder] : [];
    case 'tags': return image.tags ?? [];
    case 'description': return image.description ? [image.description] : [];
    case 'altText': return image.altText || image.altTag ? [image.altText ?? image.altTag ?? ''] : [];
    case 'namespace': return image.namespace ? [image.namespace] : [];
    case 'sourceUrl': return image.sourceUrl ? [image.sourceUrl] : [];
    case 'originalUrl': return image.originalUrl ? [image.originalUrl] : [];
  }
}

function buildMatcher(query: string, match: MetadataMatchMode, caseSensitive: boolean): (value: string) => boolean {
  if (match === 'regex') {
    const regex = new RegExp(query, caseSensitive ? undefined : 'i');
    return (value) => regex.test(value);
  }
  const normalize = (value: string) => caseSensitive ? value : value.toLowerCase();
  const needle = normalize(query);
  if (match === 'exact') return (value) => normalize(value) === needle;
  if (match === 'prefix') return (value) => normalize(value).startsWith(needle);
  return (value) => normalize(value).includes(needle);
}

function resolveFields(fields?: MetadataSearchField[]): MetadataSearchField[] {
  if (!fields?.length) return [...METADATA_SEARCH_FIELDS];
  const requested = new Set(fields);
  const resolved = METADATA_SEARCH_FIELDS.filter((field) => requested.has(field));
  return resolved.length ? resolved : [...METADATA_SEARCH_FIELDS];
}

export async function searchImageMetadata(request: MetadataSearchRequest): Promise<MetadataSearchResponse> {
  const startedAt = performance.now();
  const query = request.query.trim();
  if (!query) throw new Error('query is required');
  const match = request.match ?? 'contains';
  const fields = resolveFields(request.fields);
  const matcher = buildMatcher(query, match, request.caseSensitive ?? false);
  const images = (await getCachedImages()).filter((image) => {
    if (request.namespace !== undefined && request.namespace !== '__all__') {
      if (request.namespace === '__none__' ? Boolean(image.namespace) : image.namespace !== request.namespace) return false;
    }
    return true;
  });
  const indexResult = match === 'regex' ? null : await queryMetadataIndex({
    query,
    fields,
    namespace: request.namespace,
    folder: request.folder,
    expectedCount: images.length,
  }).catch(() => null);
  const candidateIds = indexResult ? new Set(indexResult.imageIds) : null;
  const candidates = candidateIds ? images.filter((image) => candidateIds.has(image.id)) : images;
  const extrasById = await getImageExtrasRecords(candidates.map((image) => image.id));
  const limit = request.limit ?? 50;
  const results: MetadataSearchImage[] = [];

  for (const source of candidates) {
    const image = mergeExtras(source, extrasById[source.id] ?? null);
    if (request.folder !== undefined && image.folder !== request.folder) continue;
    const matchedFields = fields.filter((field) => fieldValues(image, field).some(matcher));
    if (!matchedFields.length) continue;
    results.push({ ...image, matchedFields });
    if (limit > 0 && results.length >= limit) break;
  }

  return {
    results,
    query,
    count: results.length,
    fields,
    match,
    diagnostics: {
      backend: indexResult ? 'redis-index' : 'server-scan',
      candidateCount: candidates.length,
      fallbackReason: indexResult ? undefined : match === 'regex' ? 'regex' : query.length < 3 ? 'short-query' : 'index-unavailable-or-incomplete',
      indexVersion: indexResult?.version,
      elapsedMs: Number((performance.now() - startedAt).toFixed(1)),
    },
  };
}
