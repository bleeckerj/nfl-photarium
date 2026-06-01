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
import type { EmbeddingLogContext } from './embeddingService';
import { COLOR_HISTOGRAM_DIM } from './colorExtraction';
import { hexToHsl, hslToHex } from './vectorColorTransforms';

// Redis client type
interface RedisClient {
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
const INDEX_NAME = 'idx:images';
const KEY_PREFIX = 'image:';

// Vector field names
const CLIP_FIELD = 'clip_embedding';
const COLOR_FIELD = 'color_histogram';
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
async function getRedisClient(): Promise<RedisClient> {
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
function vectorToBuffer(vector: number[]): Buffer {
  const buffer = Buffer.alloc(vector.length * 4); // float32 = 4 bytes
  for (let i = 0; i < vector.length; i++) {
    buffer.writeFloatLE(vector[i], i * 4);
  }
  return buffer;
}

/**
 * Convert a Buffer back to a number array
 */
function bufferToVector(buffer: Buffer): number[] {
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
 * Search for semantically distant images ("strangers") using CLIP embeddings
 * Returns images that are most UNLIKE the query embedding
 * 
 * Strategy: Scan all vectors and compute cosine distance, return highest distances.
 * With cosine distance in Redis: 0 = identical, 2 = opposite.
 * 
 * @param embedding - Query embedding (512-dim)
 * @param limit - Maximum results to return (default: 4)
 * @param offset - Number of results to skip (default: 0)
 * @returns Most dissimilar images sorted by distance (highest first)
 */
export async function searchCLIPStrangers(
  embedding: number[],
  limit = 4,
  offset = 0
): Promise<VectorSearchResult[]> {
  const client = await getRedisClient();

  // Get ALL images with embeddings to find truly distant ones
  // We query for a large number and then sort by distance DESC
  const searchLimit = 500; // Scan up to 500 images
  const query = `*=>[KNN ${searchLimit} @${CLIP_FIELD} $vec AS score]`;

  const result = await client.call(
    'FT.SEARCH',
    INDEX_NAME,
    query,
    'PARAMS', '2', 'vec', vectorToBuffer(embedding),
    'SORTBY', 'score', 'ASC', // Lowest distance (most similar) first
    'LIMIT', '0', searchLimit.toString(),
    'RETURN', '3', 'filename', 'folder', 'score',
    'DIALECT', '2'
  ) as [number, ...unknown[]];

  const allResults = parseSearchResults(result);
  
  // Sort by score DESCENDING (highest distance = most different)
  // Cosine distance: 0 = identical, 2 = opposite
  allResults.sort((a, b) => b.score - a.score);
  
  // Return the requested slice of most distant images
  return allResults.slice(offset, offset + limit);
}

/**
 * Search for similar images using CLIP embeddings
 * 
 * @param embedding - Query embedding (512-dim)
 * @param limit - Maximum results to return (default: 10)
 * @param filter - Optional filter (e.g., "@folder:{travel}")
 * @returns Similar images sorted by similarity
 */
export async function searchByCLIP(
  embedding: number[],
  limit = 10,
  filter?: string,
  offset = 0
): Promise<VectorSearchResult[]> {
  console.log('[VectorSearch] searchByCLIP called with limit:', limit, 'offset:', offset);
  const client = await getRedisClient();

  // Build KNN query
  // FT.SEARCH idx:images "*=>[KNN 10 @clip_embedding $vec AS score]"
  //   PARAMS 2 vec <binary_vector>
  //   SORTBY score
  //   RETURN 3 filename folder score
  //   DIALECT 2
  // Note: KNN needs to fetch offset+limit to allow pagination
  const knnCount = offset + limit;

  const queryParts = filter ? `(${filter})` : '*';
  const query = `${queryParts}=>[KNN ${knnCount} @${CLIP_FIELD} $vec AS score]`;
  console.log('[VectorSearch] Redis query:', query);

  const result = await client.call(
    'FT.SEARCH',
    INDEX_NAME,
    query,
    'PARAMS', '2', 'vec', vectorToBuffer(embedding),
    'SORTBY', 'score',
    'LIMIT', offset.toString(), limit.toString(),
    'RETURN', '3', 'filename', 'folder', 'score',
    'DIALECT', '2'
  ) as [number, ...unknown[]];

  console.log('[VectorSearch] Redis result count:', result[0]);
  return parseSearchResults(result);
}

/**
 * Search for similar images by color histogram
 * 
 * @param histogram - Query color histogram (64-dim)
 * @param limit - Maximum results to return
 * @param filter - Optional filter
 * @returns Similar images sorted by color similarity
 */
export async function searchByColor(
  histogram: number[],
  limit = 10,
  filter?: string,
  offset = 0
): Promise<VectorSearchResult[]> {
  const client = await getRedisClient();

  // Note: KNN needs to fetch offset+limit to allow pagination
  const knnCount = offset + limit;

  const queryParts = filter ? `(${filter})` : '*';
  const query = `${queryParts}=>[KNN ${knnCount} @${COLOR_FIELD} $vec AS score]`;

  const result = await client.call(
    'FT.SEARCH',
    INDEX_NAME,
    query,
    'PARAMS', '2', 'vec', vectorToBuffer(histogram),
    'SORTBY', 'score',
    'LIMIT', offset.toString(), limit.toString(),
    'RETURN', '3', 'filename', 'folder', 'score',
    'DIALECT', '2'
  ) as [number, ...unknown[]];

  return parseSearchResults(result);
}

/**
 * Search by text query using CLIP text embedding
 * First generates a text embedding, then searches by vector similarity
 * 
 * @param textQuery - Natural language query (e.g., "sunset on beach")
 * @param limit - Maximum results
 */
export async function searchByText(
  textQuery: string,
  limit = 10,
  context?: EmbeddingLogContext
): Promise<VectorSearchResult[]> {
  console.log('[VectorSearch] searchByText called', { limit, context });
  // Import embedding service dynamically to avoid circular dependency
  const { generateClipTextEmbedding } = await import('./embeddingService');
  
  const embedding = await generateClipTextEmbedding(textQuery, context);
  if (!embedding) {
    console.error('[VectorSearch] Failed to generate text embedding');
    return [];
  }

  return searchByCLIP(embedding, limit);
}

/**
 * Find images with similar color to a hex color
 * Creates a histogram dominated by that color and searches
 * 
 * @param hexColor - Hex color code (e.g., "#3B82F6")
 * @param limit - Maximum results
 */
export async function searchByHexColor(
  hexColor: string,
  limit = 10
): Promise<VectorSearchResult[]> {
  const { hexToRgb } = await import('./colorExtraction');
  
  const rgb = hexToRgb(hexColor);
  if (!rgb) {
    console.error('[VectorSearch] Invalid hex color:', hexColor);
    return [];
  }

  // Create a histogram with the target color as dominant
  const histogram = new Array(COLOR_HISTOGRAM_DIM).fill(0);
  
  // Calculate the bin for this color
  const rBin = Math.min(3, Math.floor(rgb.r / 64));
  const gBin = Math.min(3, Math.floor(rgb.g / 64));
  const bBin = Math.min(3, Math.floor(rgb.b / 64));
  const binIndex = rBin * 16 + gBin * 4 + bBin;
  
  // Set high weight for target color bin and neighbors
  histogram[binIndex] = 0.7;
  
  // Add some weight to nearby bins for better matching
  const neighbors = getNeighborBins(binIndex);
  for (const neighbor of neighbors) {
    histogram[neighbor] = 0.3 / neighbors.length;
  }

  return searchByColor(histogram, limit);
}

/**
 * Get neighboring bins in the 4x4x4 color histogram
 */
function getNeighborBins(binIndex: number): number[] {
  const r = Math.floor(binIndex / 16);
  const g = Math.floor((binIndex % 16) / 4);
  const b = binIndex % 4;

  const neighbors: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dg = -1; dg <= 1; dg++) {
      for (let db = -1; db <= 1; db++) {
        if (dr === 0 && dg === 0 && db === 0) continue;
        
        const nr = r + dr;
        const ng = g + dg;
        const nb = b + db;
        
        if (nr >= 0 && nr < 4 && ng >= 0 && ng < 4 && nb >= 0 && nb < 4) {
          neighbors.push(nr * 16 + ng * 4 + nb);
        }
      }
    }
  }

  return neighbors;
}

/**
 * Parse FT.SEARCH results into VectorSearchResult array
 */
function parseSearchResults(result: [number, ...unknown[]]): VectorSearchResult[] {
  const [count, ...items] = result;
  const results: VectorSearchResult[] = [];

  // Results come in pairs: [key, [field, value, field, value, ...]]
  for (let i = 0; i < items.length; i += 2) {
    const key = items[i] as string;
    const fields = items[i + 1] as string[];

    const imageId = key.replace(KEY_PREFIX, '');
    const fieldsMap: Record<string, string> = {};

    for (let j = 0; j < fields.length; j += 2) {
      fieldsMap[fields[j]] = fields[j + 1];
    }

    results.push({
      imageId,
      score: parseFloat(fieldsMap.score) || 0,
      filename: fieldsMap.filename,
      folder: fieldsMap.folder,
    });
  }

  return results;
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

// ============================================================================
// OPPOSITE / ANTIPODE SEARCH FUNCTIONS
// ============================================================================

/**
 * Option A: "Negate the Vector" - Flip the sign of all embedding dimensions
 * Searches for images closest to the negated vector (mathematical opposite)
 */
export async function searchCLIPNegated(
  embedding: number[],
  limit = 10,
  excludeId?: string
): Promise<VectorSearchResult[]> {
  const negated = embedding.map(v => -v);
  const results = await searchByCLIP(negated, limit + 1);
  return excludeId 
    ? results.filter(r => r.imageId !== excludeId).slice(0, limit)
    : results.slice(0, limit);
}

/**
 * Option B: "Very Stranger" - Find the most distant images in the collection
 */
export async function searchCLIPVeryStranger(
  embedding: number[],
  limit = 10,
  excludeId?: string
): Promise<VectorSearchResult[]> {
  const results = await searchCLIPStrangers(embedding, limit + 1);
  return excludeId 
    ? results.filter(r => r.imageId !== excludeId).slice(0, limit)
    : results.slice(0, limit);
}

/**
 * Option D: "Quantoidal Reflectroid" - Centroid reflection
 * Reflects the embedding through the collection's centroid
 * opposite = 2 * centroid - embedding
 */
export async function searchCLIPCentroidReflection(
  embedding: number[],
  limit = 10,
  excludeId?: string
): Promise<VectorSearchResult[]> {
  const client = await getRedisClient();
  
  const keys = await client.keys(`${KEY_PREFIX}*`);
  if (keys.length === 0) return [];
  
  const embeddings: number[][] = [];
  
  for (const key of keys) {
    const clipBuffer = await (client as unknown as { hgetBuffer: (key: string, field: string) => Promise<Buffer | null> }).hgetBuffer(key, CLIP_FIELD);
    if (clipBuffer && Buffer.isBuffer(clipBuffer)) {
      embeddings.push(bufferToVector(clipBuffer));
    }
  }
  
  if (embeddings.length === 0) return [];
  
  const dim = embeddings[0].length;
  const centroid = new Array(dim).fill(0);
  
  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) {
      centroid[i] += emb[i];
    }
  }
  
  for (let i = 0; i < dim; i++) {
    centroid[i] /= embeddings.length;
  }
  
  const reflected = centroid.map((c, i) => 2 * c - embedding[i]);
  
  const results = await searchByCLIP(reflected, limit + 1);
  return excludeId 
    ? results.filter(r => r.imageId !== excludeId).slice(0, limit)
    : results.slice(0, limit);
}

// ============================================================================
// COLOR OPPOSITE SEARCH FUNCTIONS
// ============================================================================

/**
 * Color Option A: "Complementary" - 180° hue rotation
 */
export async function searchColorComplementary(
  hexColor: string,
  limit = 10,
  excludeId?: string
): Promise<VectorSearchResult[]> {
  const hsl = hexToHsl(hexColor);
  const complementHue = (hsl.h + 180) % 360;
  const complementHex = hslToHex(complementHue, hsl.s, hsl.l);
  
  const results = await searchByHexColor(complementHex, limit + 1);
  return excludeId 
    ? results.filter(r => r.imageId !== excludeId).slice(0, limit)
    : results.slice(0, limit);
}

/**
 * Color Option B: "Histogram Inversion" - Emphasizes absent colors
 */
export async function searchColorHistogramInverted(
  histogram: number[],
  limit = 10,
  excludeId?: string
): Promise<VectorSearchResult[]> {
  const maxVal = Math.max(...histogram);
  const inverted = histogram.map(v => maxVal - v);
  
  const results = await searchByColor(inverted, limit + 1);
  return excludeId 
    ? results.filter(r => r.imageId !== excludeId).slice(0, limit)
    : results.slice(0, limit);
}

/**
 * Color Option C: "Lightness Inversion" - Flip lightness and saturation
 */
export async function searchColorLightnessInverted(
  hexColor: string,
  limit = 10,
  excludeId?: string
): Promise<VectorSearchResult[]> {
  const hsl = hexToHsl(hexColor);
  const invertedL = 100 - hsl.l;
  const invertedS = 100 - hsl.s;
  const invertedHex = hslToHex(hsl.h, invertedS, invertedL);
  
  const results = await searchByHexColor(invertedHex, limit + 1);
  return excludeId 
    ? results.filter(r => r.imageId !== excludeId).slice(0, limit)
    : results.slice(0, limit);
}

/**
 * Color Option D: "Negative Space" - Negated histogram
 */
export async function searchColorNegativeSpace(
  histogram: number[],
  limit = 10,
  excludeId?: string
): Promise<VectorSearchResult[]> {
  const negated = histogram.map(v => -v);
  
  const results = await searchByColor(negated, limit + 1);
  return excludeId 
    ? results.filter(r => r.imageId !== excludeId).slice(0, limit)
    : results.slice(0, limit);
}

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
