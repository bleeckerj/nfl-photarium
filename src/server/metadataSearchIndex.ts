import { getCachedImages, type CachedCloudflareImage } from '@/server/cloudflareImageCache';
import type { ImageExtrasRecord } from '@/server/imageExtras';
import type { MetadataSearchField } from '@/server/metadataSearch';

const VERSION = 'v1';
const PREFIX = `photarium:metadata-search:${VERSION}`;

type RedisClient = {
  del(...keys: string[]): Promise<number>;
  get(key: string): Promise<string | null>;
  mget(...keys: string[]): Promise<Array<string | null>>;
  sadd(key: string, ...members: string[]): Promise<number>;
  scard(key: string): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  sinter(...keys: string[]): Promise<string[]>;
  scan(cursor: string, ...args: string[]): Promise<[string, string[]]>;
  quit(): Promise<unknown>;
  pipeline(): {
    set(key: string, value: string): unknown;
    sadd(key: string, ...members: string[]): unknown;
    srem(key: string, ...members: string[]): unknown;
    del(key: string): unknown;
    exec(): Promise<unknown>;
  };
};

type SearchDocument = {
  imageId: string;
  memberships: string[];
  updatedAt: string;
};

let clientPromise: Promise<RedisClient | null> | null = null;

async function getClient(): Promise<RedisClient | null> {
  if (!process.env.REDIS_URL) return null;
  if (!clientPromise) {
    clientPromise = import(/* webpackIgnore: true */ 'ioredis' as string)
      .then(({ default: Redis }) => new Redis(process.env.REDIS_URL, {
        maxRetriesPerRequest: 2,
        lazyConnect: true,
        enableReadyCheck: true,
      }) as RedisClient)
      .catch(() => null);
  }
  return clientPromise;
}

const encode = (value: string) => Buffer.from(value).toString('base64url');
const normalize = (value: string) => value.trim().toLowerCase();
const docKey = (id: string) => `${PREFIX}:doc:${id}`;
const idsKey = `${PREFIX}:ids`;
const scopeKey = (kind: 'namespace' | 'folder', value: string) => `${PREFIX}:scope:${kind}:${encode(normalize(value))}`;
const trigramKey = (field: MetadataSearchField, gram: string) => `${PREFIX}:tri:${field}:${encode(gram)}`;

function trigrams(value: string): string[] {
  const text = normalize(value);
  if (text.length < 3) return [];
  return [...new Set(Array.from({ length: text.length - 2 }, (_, index) => text.slice(index, index + 3)))];
}

function valuesFor(image: CachedCloudflareImage, extras: ImageExtrasRecord | null, field: MetadataSearchField): string[] {
  switch (field) {
    case 'filename': return [image.filename];
    case 'folder': return [extras?.folder ?? image.folder ?? ''];
    case 'tags': return image.tags ?? [];
    case 'description': return [extras?.description ?? image.description ?? ''];
    case 'altText': return [extras?.altText ?? image.altTag ?? ''];
    case 'namespace': return [image.namespace ?? ''];
    case 'sourceUrl': return [extras?.sourceUrl ?? image.sourceUrl ?? ''];
    case 'originalUrl': return [extras?.originalUrl ?? image.originalUrl ?? ''];
  }
}

export async function indexMetadataImage(image: CachedCloudflareImage, extras: ImageExtrasRecord | null): Promise<boolean> {
  const client = await getClient();
  if (!client) return false;
  const oldRaw = await client.get(docKey(image.id));
  const old = oldRaw ? JSON.parse(oldRaw) as SearchDocument : null;
  const memberships = new Set<string>();
  memberships.add(idsKey);
  memberships.add(scopeKey('namespace', image.namespace ?? '__none__'));
  memberships.add(scopeKey('folder', extras?.folder ?? image.folder ?? '__none__'));
  const fields: MetadataSearchField[] = ['filename', 'folder', 'tags', 'description', 'altText', 'namespace', 'sourceUrl', 'originalUrl'];
  for (const field of fields) {
    for (const value of valuesFor(image, extras, field)) {
      for (const gram of trigrams(value)) memberships.add(trigramKey(field, gram));
    }
  }
  const pipeline = client.pipeline();
  for (const key of old?.memberships ?? []) pipeline.srem(key, image.id);
  for (const key of memberships) pipeline.sadd(key, image.id);
  pipeline.set(docKey(image.id), JSON.stringify({ imageId: image.id, memberships: [...memberships], updatedAt: new Date().toISOString() } satisfies SearchDocument));
  await pipeline.exec();
  return true;
}

export async function removeMetadataImage(imageId: string): Promise<boolean> {
  const client = await getClient();
  if (!client) return false;
  const raw = await client.get(docKey(imageId));
  if (!raw) return true;
  const document = JSON.parse(raw) as SearchDocument;
  const pipeline = client.pipeline();
  for (const key of document.memberships) pipeline.srem(key, imageId);
  pipeline.del(docKey(imageId));
  await pipeline.exec();
  return true;
}

export async function queryMetadataIndex(options: {
  query: string;
  fields: MetadataSearchField[];
  namespace?: string;
  folder?: string;
  expectedCount: number;
}): Promise<{ imageIds: string[]; version: string } | null> {
  const client = await getClient();
  if (!client || normalize(options.query).length < 3) return null;
  const coverageKey = options.namespace !== undefined && options.namespace !== '__all__'
    ? scopeKey('namespace', options.namespace === '__none__' ? '__none__' : options.namespace)
    : idsKey;
  if (await client.scard(coverageKey) !== options.expectedCount) return null;
  const keys: string[] = [];
  if (options.namespace !== undefined && options.namespace !== '__all__') {
    keys.push(scopeKey('namespace', options.namespace === '__none__' ? '__none__' : options.namespace));
  }
  if (options.folder !== undefined) keys.push(scopeKey('folder', options.folder));
  const fieldKeys = options.fields.flatMap((field) => trigrams(options.query).map((gram) => trigramKey(field, gram)));
  if (!fieldKeys.length) return null;
  const candidates = new Set<string>();
  for (const field of options.fields) {
    const grams = trigrams(options.query).map((gram) => trigramKey(field, gram));
    const ids = await client.sinter(...keys, ...grams);
    ids.forEach((id) => candidates.add(id));
  }
  return { imageIds: [...candidates], version: VERSION };
}

export async function syncMetadataImageById(imageId: string, extras?: ImageExtrasRecord | null): Promise<boolean> {
  if (!process.env.REDIS_URL) return false;
  try {
    const image = (await getCachedImages()).find((candidate) => candidate.id === imageId);
    if (!image) return removeMetadataImage(imageId);
    let resolvedExtras = extras;
    if (resolvedExtras === undefined) {
      const { getImageExtrasRecord } = await import('@/server/imageExtras');
      resolvedExtras = await getImageExtrasRecord(imageId);
    }
    return indexMetadataImage(image, resolvedExtras ?? null);
  } catch (error) {
    console.warn('[MetadataSearchIndex] Sync failed', { imageId, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

export async function clearMetadataSearchIndex(): Promise<number> {
  const client = await getClient();
  if (!client) return 0;
  let cursor = '0';
  let deleted = 0;
  do {
    const [next, keys] = await client.scan(cursor, 'MATCH', `${PREFIX}:*`, 'COUNT', '500');
    cursor = next;
    if (keys.length) deleted += await client.del(...keys);
  } while (cursor !== '0');
  return deleted;
}

export async function isMetadataImageIndexed(imageId: string): Promise<boolean> {
  const client = await getClient();
  return client ? Boolean(await client.get(docKey(imageId))) : false;
}

export async function closeMetadataSearchIndex(): Promise<void> {
  if (!clientPromise) return;
  const client = await clientPromise;
  clientPromise = null;
  if (client) await client.quit();
}

export const METADATA_SEARCH_INDEX_VERSION = VERSION;
