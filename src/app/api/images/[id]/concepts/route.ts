/**
 * Concept Radar API Route
 * 
 * POST /api/images/[id]/concepts
 * 
 * Returns semantic concept scores for an image by comparing its CLIP embedding
 * against text embeddings of concept words. This creates a "vibe radar" showing
 * how the machine interprets the semantic qualities of the image.
 * 
 * The concepts are organized as pairs (poles), and the score indicates
 * which pole the image is closer to (-1 to 1).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getImageVectors, isVectorSearchAvailable } from '@/server/vectorSearch';
import { generateClipTextEmbedding, type EmbeddingLogContext } from '@/server/embeddingService';

// Concept pairs - each pair represents opposite poles of a semantic dimension
// Format: [negative_pole, positive_pole]
const CONCEPT_PAIRS: [string, string][] = [
  ['artificial', 'organic'],
  ['chaotic', 'ordered'],
  ['intimate', 'vast'],
  ['nostalgic', 'futuristic'],
  ['soft', 'hard'],
  ['dark', 'bright'],
  ['static', 'dynamic'],
  ['serious', 'playful'],
  ['minimal', 'complex'],
  ['cold', 'warm'],
];

// Cache for text embeddings (they don't change)
const textEmbeddingCache = new Map<string, number[]>();

type ConceptCacheEntry = {
  at: number;
  concepts: ConceptScore[];
};

const parsedConceptTtl = parseInt(process.env.CONCEPTS_CACHE_TTL_MS || '600000', 10);
const CONCEPT_CACHE_TTL_MS =
  Number.isFinite(parsedConceptTtl) && parsedConceptTtl >= 0
    ? parsedConceptTtl
    : 600000;

const getConceptCache = () => {
  const globalScope = globalThis as typeof globalThis & {
    __photariumConceptCache?: Map<string, ConceptCacheEntry>;
  };
  if (!globalScope.__photariumConceptCache) {
    globalScope.__photariumConceptCache = new Map<string, ConceptCacheEntry>();
  }
  return globalScope.__photariumConceptCache;
};

const getConceptInFlight = () => {
  const globalScope = globalThis as typeof globalThis & {
    __photariumConceptInFlight?: Map<string, Promise<ConceptScore[]>>;
  };
  if (!globalScope.__photariumConceptInFlight) {
    globalScope.__photariumConceptInFlight = new Map<string, Promise<ConceptScore[]>>();
  }
  return globalScope.__photariumConceptInFlight;
};

const getCachedConcepts = (imageId: string): ConceptCacheEntry | null => {
  if (CONCEPT_CACHE_TTL_MS <= 0) return null;
  const cache = getConceptCache();
  const entry = cache.get(imageId);
  if (!entry) return null;
  if (Date.now() - entry.at > CONCEPT_CACHE_TTL_MS) {
    cache.delete(imageId);
    return null;
  }
  return entry;
};

const setCachedConcepts = (imageId: string, concepts: ConceptScore[]) => {
  if (CONCEPT_CACHE_TTL_MS <= 0) return;
  getConceptCache().set(imageId, { at: Date.now(), concepts });
};

async function getTextEmbedding(
  text: string,
  contextBase?: EmbeddingLogContext
): Promise<number[] | null> {
  if (textEmbeddingCache.has(text)) {
    return textEmbeddingCache.get(text)!;
  }
  
  const embedding = await generateClipTextEmbedding(text, {
    ...contextBase,
    query: text,
  });
  if (embedding) {
    textEmbeddingCache.set(text, embedding);
  }
  return embedding;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

export interface ConceptScore {
  /** The semantic dimension name (e.g., "artificial-organic") */
  dimension: string;
  /** The negative pole label */
  negative: string;
  /** The positive pole label */
  positive: string;
  /** Score from -1 (negative pole) to 1 (positive pole) */
  score: number;
  /** Raw similarity to negative pole (0-1) */
  negativeRaw: number;
  /** Raw similarity to positive pole (0-1) */
  positiveRaw: number;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
  const requestId = request.headers.get('x-request-id') || crypto.randomUUID();
  const userAgent = request.headers.get('user-agent') ?? undefined;
  const referer = request.headers.get('referer') ?? undefined;
  const origin = request.headers.get('origin') ?? undefined;
  const forwardFor = request.headers.get('x-forwarded-for') ?? undefined;
  const realIp = request.headers.get('x-real-ip') ?? undefined;
  const ip = (forwardFor?.split(',')[0] || realIp || '').trim() || undefined;
  const component = request.headers.get('x-photarium-component') ?? 'ConceptRadar';
  const trigger = request.headers.get('x-photarium-trigger') ?? 'unknown';
  const source = request.headers.get('x-photarium-source') ?? 'api';

  try {
    console.log('[Concepts API] Received request:', {
      requestId,
      imageId: id,
      component,
      trigger,
      source,
      ip,
      userAgent,
      referer,
      origin,
    });

    // Check if vector search is available
    const available = await isVectorSearchAvailable();
    if (!available) {
      return NextResponse.json(
        { error: 'Vector search not available. Ensure Redis Stack is running.' },
        { status: 503 }
      );
    }

    // Get the image's CLIP embedding from Redis
    const vectors = await getImageVectors(id);
    if (!vectors?.clipEmbedding) {
      return NextResponse.json(
        { error: 'Image does not have CLIP embedding. Generate embeddings first.' },
        { status: 404 }
      );
    }

    const cached = getCachedConcepts(id);
    if (cached) {
      const cacheAgeMs = Date.now() - cached.at;
      console.log('[Concepts API] Cache hit', { requestId, imageId: id, cacheAgeMs });
      return NextResponse.json({
        imageId: id,
        concepts: cached.concepts,
        cached: true,
        cacheAgeMs,
      });
    }

    const inFlight = getConceptInFlight();
    const existing = inFlight.get(id);
    if (existing) {
      console.log('[Concepts API] Awaiting in-flight computation', { requestId, imageId: id });
      const concepts = await existing;
      return NextResponse.json({
        imageId: id,
        concepts,
        cached: true,
        inFlight: true,
      });
    }

    const imageEmbedding = vectors.clipEmbedding;
    const conceptScores: ConceptScore[] = [];

    // Calculate scores for each concept pair
    const contextBase: EmbeddingLogContext = {
      requestId,
      source,
      route: 'POST /api/images/[id]/concepts',
      component,
      trigger,
      ip,
      userAgent,
      referer,
      origin,
    };

    const computePromise = (async () => {
      for (const [negative, positive] of CONCEPT_PAIRS) {
        // Get text embeddings for both poles
        const [negativeEmb, positiveEmb] = await Promise.all([
          getTextEmbedding(`a ${negative} image`, contextBase),
          getTextEmbedding(`a ${positive} image`, contextBase),
        ]);

        if (!negativeEmb || !positiveEmb) {
          console.warn(`[Concepts] Failed to get embeddings for ${negative}/${positive}`);
          continue;
        }

        // Calculate similarity to each pole
        const negativeRaw = cosineSimilarity(imageEmbedding, negativeEmb);
        const positiveRaw = cosineSimilarity(imageEmbedding, positiveEmb);

        // Convert to -1 to 1 scale
        // If both similarities are equal, score is 0
        // If more similar to positive, score is positive
        const total = negativeRaw + positiveRaw;
        const score = total === 0 ? 0 : (positiveRaw - negativeRaw) / Math.max(Math.abs(positiveRaw), Math.abs(negativeRaw));

        conceptScores.push({
          dimension: `${negative}-${positive}`,
          negative,
          positive,
          score: Math.max(-1, Math.min(1, score)), // Clamp to [-1, 1]
          negativeRaw,
          positiveRaw,
        });
      }

      return conceptScores;
    })();

    inFlight.set(id, computePromise);

    try {
      const computed = await computePromise;
      setCachedConcepts(id, computed);
      return NextResponse.json({
        imageId: id,
        concepts: computed,
        cached: false,
      });
    } finally {
      inFlight.delete(id);
    }
  } catch (error) {
    console.error('[API] Error calculating concept scores:', error);
    return NextResponse.json(
      { error: 'Failed to calculate concept scores', details: String(error) },
      { status: 500 }
    );
  }
}
