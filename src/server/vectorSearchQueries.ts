import type { EmbeddingLogContext } from './embeddingService';
import { COLOR_HISTOGRAM_DIM } from './colorExtraction';
import type { VectorSearchResult } from './vectorSearch';
import {
  COLOR_FIELD,
  CLIP_FIELD,
  INDEX_NAME,
  KEY_PREFIX,
  getRedisClient,
  vectorToBuffer,
} from './vectorSearch';

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
  const [, ...items] = result;
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

