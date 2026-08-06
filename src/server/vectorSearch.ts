/**
 * Vector Search Service
 * 
 * Provides vector similarity search using Redis Stack (RediSearch).
 * Supports both CLIP embeddings (semantic search) and color histograms (color search).
 * 
 * Redis Stack must be running with RediSearch module enabled.
 * Use: docker compose up -d (starts redis/redis-stack)
 * 
 * Index Schema:
 *   - idx:images - Main image index with vector fields
 *   - CLIP embedding: 512-dim FLOAT32 vector
 *   - Color histogram: 64-dim FLOAT32 vector
 */

import { CLIP_EMBEDDING_DIM } from './embeddingService';
import { COLOR_HISTOGRAM_DIM } from './colorExtraction';

// Redis client type
export interface RedisClient {
  call(command: string, ...args: (string | number | Buffer)[]): Promise<unknown>;
  hset(key: string, data: Record<string, string | number | Buffer>): Promise<number>;
  hget(key: string, field: string): Promise<string | null>;
  hgetall(key: string): Promise<Record<string, string> | null>;
  hdel(key: string, ...fields: string[]): Promise<number>;
  del(key: string): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  quit(): Promise<unknown>;
  on(event: string, callback: (arg?: unknown) => void): void;
}

// Vector index configuration
export const INDEX_NAME = 'idx:images';
export const KEY_PREFIX = 'image:';

// Vector field names
export const CLIP_FIELD = 'clip_embedding';
export const COLOR_FIELD = 'color_histogram';
const ASPECT_RATIO_FIELD = 'aspect_ratio';
const ASPECT_RATIO_CLASS_FIELD = 'aspect_ratio_class';
const WIDTH_FIELD = 'width';
const HEIGHT_FIELD = 'height';

export interface VectorSearchResult {
  imageId: string;
  score: number;
  filename?: string;
  folder?: string;
}

export interface ImageVectorData {
  imageId: string;
  filename?: string;
  folder?: string;
  clipEmbedding?: number[];
  colorHistogram?: number[];
  dominantColors?: string[];
  averageColor?: string;
  aspectRatio?: string;
  aspectRatioClass?: string;
  width?: number;
  height?: number;
}

export interface ImageAspectMetadata {
  imageId: string;
  aspectRatio?: string;
  aspectRatioClass?: string;
  width?: number;
  height?: number;
}

export interface ImageColorMetadata {
  imageId: string;
  dominantColors?: string[];
  averageColor?: string;
  hasClipEmbedding: boolean;
  hasColorEmbedding: boolean;
}

export interface ImageAspectRatioMetadata {
  imageId: string;
  aspectRatio?: string;
  aspectRatioClass?: string;
  width?: number;
  height?: number;
}

// Singleton client instance
let redisClient: RedisClient | null = null;
let connectionPromise: Promise<void> | null = null;
let vectorAvailabilityCache: { value: boolean; checkedAt: number } | null = null;
const VECTOR_AVAILABILITY_TTL_MS = Math.max(
  1_000,
  Number(process.env.VECTOR_AVAILABILITY_TTL_MS ?? 15_000)
);
const VECTOR_METADATA_CACHE_TTL_MS = Math.max(
  1_000,
  Number(process.env.VECTOR_METADATA_CACHE_TTL_MS ?? 60_000)
);
type MetadataCacheEntry<T> = { value: T | null; checkedAt: number };
const colorMetadataCache = new Map<string, MetadataCacheEntry<ImageColorMetadata>>();
const aspectMetadataCache = new Map<string, MetadataCacheEntry<ImageAspectRatioMetadata>>();

function getFreshMetadataCacheValue<T>(
  cache: Map<string, MetadataCacheEntry<T>>,
  key: string,
  now: number
): T | null | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (now - entry.checkedAt > VECTOR_METADATA_CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function setMetadataCacheValue<T>(
  cache: Map<string, MetadataCacheEntry<T>>,
  key: string,
  value: T | null,
  checkedAt: number
): void {
  cache.set(key, { value, checkedAt });
}

/**
 * Get or create Redis client connection
 */
export async function getRedisClient(): Promise<RedisClient> {
  if (redisClient) {
    return redisClient;
  }

  if (connectionPromise) {
    await connectionPromise;
    return redisClient!;
  }

  connectionPromise = connect();
  await connectionPromise;
  return redisClient!;
}

async function connect(): Promise<void> {
  const Redis = (await import(/* webpackIgnore: true */ 'ioredis' as string)).default;
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

  const client = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });

  client.on('error', (err: Error) => {
    console.error('[VectorSearch] Redis error:', err.message);
  });

  await client.connect();
  redisClient = client as unknown as RedisClient;
  console.log('[VectorSearch] Connected to Redis');
}

/**
 * Create the vector search index if it doesn't exist
 * 
 * This creates a RediSearch index with:
 * - CLIP embedding field (512-dim, cosine distance)
 * - Color histogram field (64-dim, cosine distance)
 * - Text fields for filtering (filename, folder)
 */
export async function ensureVectorIndex(): Promise<void> {
  const client = await getRedisClient();

  try {
    // Check if index exists
    await client.call('FT.INFO', INDEX_NAME);
    console.log('[VectorSearch] Index already exists');
    return;
  } catch {
    // Index doesn't exist, create it
    console.log('[VectorSearch] Creating vector index...');
  }

  try {
    // Create the index with vector fields
    // FT.CREATE idx:images ON HASH PREFIX 1 image:
    //   SCHEMA
    //     filename TEXT SORTABLE
    //     folder TAG SORTABLE
    //     clip_embedding VECTOR FLAT 6 TYPE FLOAT32 DIM 512 DISTANCE_METRIC COSINE
    //     color_histogram VECTOR FLAT 6 TYPE FLOAT32 DIM 64 DISTANCE_METRIC COSINE
    //     dominant_colors TEXT
    //     average_color TAG

    await client.call(
      'FT.CREATE',
      INDEX_NAME,
      'ON', 'HASH',
      'PREFIX', '1', KEY_PREFIX,
      'SCHEMA',
      'filename', 'TEXT', 'SORTABLE',
      'folder', 'TAG', 'SORTABLE',
      CLIP_FIELD, 'VECTOR', 'FLAT', '6',
        'TYPE', 'FLOAT32',
        'DIM', CLIP_EMBEDDING_DIM.toString(),
        'DISTANCE_METRIC', 'COSINE',
      COLOR_FIELD, 'VECTOR', 'FLAT', '6',
        'TYPE', 'FLOAT32',
        'DIM', COLOR_HISTOGRAM_DIM.toString(),
        'DISTANCE_METRIC', 'COSINE',
      'dominant_colors', 'TEXT',
      'average_color', 'TAG'
    );

    console.log('[VectorSearch] Vector index created successfully');
  } catch (error) {
    console.error('[VectorSearch] Failed to create index:', error);
    throw error;
  }
}

/**
 * Convert a number array to a Buffer for Redis vector storage
 */
export function vectorToBuffer(vector: number[]): Buffer {
  const buffer = Buffer.alloc(vector.length * 4); // float32 = 4 bytes
  for (let i = 0; i < vector.length; i++) {
    buffer.writeFloatLE(vector[i], i * 4);
  }
  return buffer;
}

/**
 * Convert a Buffer back to a number array
 */
export function bufferToVector(buffer: Buffer): number[] {
  const vector: number[] = [];
  for (let i = 0; i < buffer.length; i += 4) {
    vector.push(buffer.readFloatLE(i));
  }
  return vector;
}

/**
 * Store vector embeddings for an image
 * 
 * @param data - Image vector data to store
 */
export async function storeImageVectors(data: ImageVectorData): Promise<void> {
  const client = await getRedisClient();
  const key = `${KEY_PREFIX}${data.imageId}`;

  const fields: Record<string, string | Buffer> = {};

  if (data.filename) {
    fields.filename = data.filename;
  }

  if (data.folder) {
    fields.folder = data.folder;
  }

  if (data.clipEmbedding) {
    fields[CLIP_FIELD] = vectorToBuffer(data.clipEmbedding);
  }

  if (data.colorHistogram) {
    fields[COLOR_FIELD] = vectorToBuffer(data.colorHistogram);
  }

  if (data.dominantColors) {
    fields.dominant_colors = data.dominantColors.join(',');
  }

  if (data.averageColor) {
    fields.average_color = data.averageColor;
  }

  if (data.aspectRatio) {
    fields[ASPECT_RATIO_FIELD] = data.aspectRatio;
  }

  if (data.aspectRatioClass) {
    fields[ASPECT_RATIO_CLASS_FIELD] = data.aspectRatioClass;
  }

  if (typeof data.width === 'number') {
    fields[WIDTH_FIELD] = String(data.width);
  }

  if (typeof data.height === 'number') {
    fields[HEIGHT_FIELD] = String(data.height);
  }

  await client.hset(key, fields);
  // Invalidate metadata caches so subsequent reads fetch fresh Redis values.
  colorMetadataCache.delete(data.imageId);
  aspectMetadataCache.delete(data.imageId);
}

export async function storeImageAspectMetadata(data: ImageAspectMetadata): Promise<void> {
  const client = await getRedisClient();
  const key = `${KEY_PREFIX}${data.imageId}`;

  const fields: Record<string, string | number> = {};

  if (data.aspectRatio) {
    fields[ASPECT_RATIO_FIELD] = data.aspectRatio;
  }

  if (data.aspectRatioClass) {
    fields[ASPECT_RATIO_CLASS_FIELD] = data.aspectRatioClass;
  }

  if (typeof data.width === 'number') {
    fields[WIDTH_FIELD] = data.width;
  }

  if (typeof data.height === 'number') {
    fields[HEIGHT_FIELD] = data.height;
  }

  if (Object.keys(fields).length > 0) {
    await client.hset(key, fields);
    aspectMetadataCache.delete(data.imageId);
  }
}

/**
 * Get stored vectors for an image
 */
export async function getImageVectors(imageId: string): Promise<ImageVectorData | null> {
  const client = await getRedisClient();
  const key = `${KEY_PREFIX}${imageId}`;

  const data = await client.hgetall(key);
  if (!data || Object.keys(data).length === 0) return null;

  const result: ImageVectorData = { imageId };

  if (data.filename) result.filename = data.filename;
  if (data.folder) result.folder = data.folder;
  if (data.dominant_colors) result.dominantColors = data.dominant_colors.split(',');
  if (data.average_color) result.averageColor = data.average_color;

  // Vector fields need special handling - they're stored as binary
  // Use hgetBuffer for binary-safe retrieval
  const clipField = await (client as unknown as { hgetBuffer: (key: string, field: string) => Promise<Buffer | null> }).hgetBuffer(key, CLIP_FIELD);
  if (clipField && Buffer.isBuffer(clipField)) {
    result.clipEmbedding = bufferToVector(clipField);
  }

  const colorField = await (client as unknown as { hgetBuffer: (key: string, field: string) => Promise<Buffer | null> }).hgetBuffer(key, COLOR_FIELD);
  if (colorField && Buffer.isBuffer(colorField)) {
    result.colorHistogram = bufferToVector(colorField);
  }

  return result;
}

/**
 * Delete vectors for an image
 */
export async function deleteImageVectors(imageId: string): Promise<void> {
  const client = await getRedisClient();
  await client.del(`${KEY_PREFIX}${imageId}`);
  colorMetadataCache.delete(imageId);
  aspectMetadataCache.delete(imageId);
}


/**
 * Get statistics about the vector index
 */
export async function getIndexStats(): Promise<{
  totalImages: number;
  indexSize: number;
  clipIndexed: number;
  colorIndexed: number;
} | null> {
  const client = await getRedisClient();

  try {
    const info = await client.call('FT.INFO', INDEX_NAME) as unknown[];
    
    // Parse FT.INFO response (array of key-value pairs)
    const infoMap: Record<string, unknown> = {};
    for (let i = 0; i < info.length; i += 2) {
      infoMap[info[i] as string] = info[i + 1];
    }

    return {
      totalImages: parseInt(infoMap.num_docs as string) || 0,
      indexSize: parseInt(infoMap.inverted_sz_mb as string) || 0,
      clipIndexed: 0, // Would need to query to count
      colorIndexed: 0,
    };
  } catch {
    return null;
  }
}

/**
 * Check if vector search is available (Redis Stack with RediSearch)
 */
export async function isVectorSearchAvailable(): Promise<boolean> {
  const now = Date.now();
  if (vectorAvailabilityCache && now - vectorAvailabilityCache.checkedAt < VECTOR_AVAILABILITY_TTL_MS) {
    return vectorAvailabilityCache.value;
  }

  try {
    const client = await getRedisClient();
    // Try to get module list - RediSearch should be present
    const modules = await client.call('MODULE', 'LIST') as unknown[][];

    const available = modules.some(mod =>
      Array.isArray(mod) && mod.some(item => 
        typeof item === 'string' && item.toLowerCase().includes('search')
      )
    );
    vectorAvailabilityCache = { value: available, checkedAt: now };
    return available;
  } catch {
    vectorAvailabilityCache = { value: false, checkedAt: now };
    return false;
  }
}

/**
 * Get color metadata for multiple images in batch
 * Returns only color info (dominant colors, average color) and embedding status flags
 */
export async function batchGetColorMetadata(imageIds: string[]): Promise<Map<string, ImageColorMetadata>> {
  const results = new Map<string, ImageColorMetadata>();
  if (imageIds.length === 0) return results;
  const now = Date.now();
  const missingIds: string[] = [];

  for (const imageId of imageIds) {
    const cached = getFreshMetadataCacheValue(colorMetadataCache, imageId, now);
    if (cached !== undefined) {
      if (cached) {
        results.set(imageId, cached);
      }
      continue;
    }
    missingIds.push(imageId);
  }

  if (missingIds.length === 0) {
    return results;
  }

  const client = await getRedisClient();

  // Use Redis pipeline for efficient batch fetching
  const pipeline = (client as unknown as { pipeline: () => {
    hget: (key: string, field: string) => unknown;
    exec: () => Promise<[Error | null, unknown][]>;
  } }).pipeline();

  // Queue up all the field requests
  for (const imageId of missingIds) {
    const key = `${KEY_PREFIX}${imageId}`;
    pipeline.hget(key, 'dominant_colors');
    pipeline.hget(key, 'average_color');
    pipeline.hget(key, CLIP_FIELD);
    pipeline.hget(key, COLOR_FIELD);
  }

  const responses = await pipeline.exec();
  if (!responses) return results;

  // Process results (4 fields per image)
  for (let i = 0; i < missingIds.length; i++) {
    const imageId = missingIds[i];
    const baseIdx = i * 4;

    const [, dominantColorsRaw] = responses[baseIdx] || [];
    const [, averageColorRaw] = responses[baseIdx + 1] || [];
    const [, clipRaw] = responses[baseIdx + 2] || [];
    const [, colorRaw] = responses[baseIdx + 3] || [];

    // Only include if we have any data
    if (dominantColorsRaw || averageColorRaw || clipRaw || colorRaw) {
      const metadata: ImageColorMetadata = {
        imageId,
        dominantColors: dominantColorsRaw && typeof dominantColorsRaw === 'string' 
          ? dominantColorsRaw.split(',')
          : undefined,
        averageColor: averageColorRaw && typeof averageColorRaw === 'string'
          ? averageColorRaw
          : undefined,
        hasClipEmbedding: !!clipRaw,
        hasColorEmbedding: !!colorRaw,
      };
      results.set(imageId, metadata);
      setMetadataCacheValue(colorMetadataCache, imageId, metadata, now);
    } else {
      // Negative cache to suppress repeated misses for the TTL duration.
      setMetadataCacheValue(colorMetadataCache, imageId, null, now);
    }
  }

  return results;
}

export async function batchGetAspectMetadata(imageIds: string[]): Promise<Map<string, ImageAspectRatioMetadata>> {
  const results = new Map<string, ImageAspectRatioMetadata>();
  if (imageIds.length === 0) return results;
  const now = Date.now();
  const missingIds: string[] = [];

  for (const imageId of imageIds) {
    const cached = getFreshMetadataCacheValue(aspectMetadataCache, imageId, now);
    if (cached !== undefined) {
      if (cached) {
        results.set(imageId, cached);
      }
      continue;
    }
    missingIds.push(imageId);
  }

  if (missingIds.length === 0) {
    return results;
  }

  const client = await getRedisClient();

  const pipeline = (client as unknown as { pipeline: () => {
    hget: (key: string, field: string) => unknown;
    exec: () => Promise<[Error | null, unknown][]>;
  } }).pipeline();

  for (const imageId of missingIds) {
    const key = `${KEY_PREFIX}${imageId}`;
    pipeline.hget(key, ASPECT_RATIO_FIELD);
    pipeline.hget(key, ASPECT_RATIO_CLASS_FIELD);
    pipeline.hget(key, WIDTH_FIELD);
    pipeline.hget(key, HEIGHT_FIELD);
  }

  const responses = await pipeline.exec();
  if (!responses) return results;

  for (let i = 0; i < missingIds.length; i++) {
    const imageId = missingIds[i];
    const baseIdx = i * 4;

    const [, aspectRatioRaw] = responses[baseIdx] || [];
    const [, aspectRatioClassRaw] = responses[baseIdx + 1] || [];
    const [, widthRaw] = responses[baseIdx + 2] || [];
    const [, heightRaw] = responses[baseIdx + 3] || [];

    if (aspectRatioRaw || aspectRatioClassRaw || widthRaw || heightRaw) {
      const width = typeof widthRaw === 'string' ? Number(widthRaw) : undefined;
      const height = typeof heightRaw === 'string' ? Number(heightRaw) : undefined;
      const metadata: ImageAspectRatioMetadata = {
        imageId,
        aspectRatio: typeof aspectRatioRaw === 'string' ? aspectRatioRaw : undefined,
        aspectRatioClass: typeof aspectRatioClassRaw === 'string' ? aspectRatioClassRaw : undefined,
        width: typeof width === 'number' && Number.isFinite(width) ? width : undefined,
        height: typeof height === 'number' && Number.isFinite(height) ? height : undefined,
      };
      results.set(imageId, metadata);
      setMetadataCacheValue(aspectMetadataCache, imageId, metadata, now);
    } else {
      setMetadataCacheValue(aspectMetadataCache, imageId, null, now);
    }
  }

  return results;
}

export {
  searchCLIPStrangers,
  searchByCLIP,
  searchByColor,
  searchByText,
  searchByHexColor,
} from './vectorSearchQueries';

export {
  searchCLIPNegated,
  searchCLIPVeryStranger,
  searchCLIPCentroidReflection,
  searchColorComplementary,
  searchColorHistogramInverted,
  searchColorLightnessInverted,
  searchColorNegativeSpace,
} from './vectorSearchOpposite';


/**
 * Disconnect from Redis
 */
export async function disconnect(): Promise<void> {
  vectorAvailabilityCache = null;
  colorMetadataCache.clear();
  aspectMetadataCache.clear();
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    connectionPromise = null;
  }
}
