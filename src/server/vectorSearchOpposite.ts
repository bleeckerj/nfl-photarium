import type { VectorSearchResult } from './vectorSearch';
import { hexToHsl, hslToHex } from './vectorColorTransforms';
import {
  CLIP_FIELD,
  KEY_PREFIX,
  bufferToVector,
  getRedisClient,
  searchByCLIP,
  searchByColor,
  searchByHexColor,
  searchCLIPStrangers,
} from './vectorSearch';

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

