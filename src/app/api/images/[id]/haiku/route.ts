/**
 * Haiku Generation API Route
 * 
 * POST /api/images/[id]/haiku
 * 
 * Generates a haiku poem inspired by the image's semantic qualities
 * derived from its CLIP embedding. Uses the concept scores to create
 * a poetic interpretation of how the machine "sees" the image.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getImageVectors, isVectorSearchAvailable } from '@/server/vectorSearch';
import { generateClipTextEmbedding } from '@/server/embeddingService';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

// Concept pairs for semantic analysis
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

// Cache for text embeddings
const textEmbeddingCache = new Map<string, number[]>();

async function getTextEmbedding(text: string): Promise<number[] | null> {
  if (textEmbeddingCache.has(text)) {
    return textEmbeddingCache.get(text)!;
  }
  
  const embedding = await generateClipTextEmbedding(text);
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

interface ConceptScore {
  dimension: string;
  negative: string;
  positive: string;
  score: number;
}

async function getConceptScores(imageEmbedding: number[]): Promise<ConceptScore[]> {
  const scores: ConceptScore[] = [];
  
  for (const [negative, positive] of CONCEPT_PAIRS) {
    const [negativeEmb, positiveEmb] = await Promise.all([
      getTextEmbedding(`a ${negative} image`),
      getTextEmbedding(`a ${positive} image`),
    ]);

    if (!negativeEmb || !positiveEmb) continue;

    const negSim = cosineSimilarity(imageEmbedding, negativeEmb);
    const posSim = cosineSimilarity(imageEmbedding, positiveEmb);
    
    // Normalize to -1 to 1 range
    const total = negSim + posSim;
    const score = total === 0 ? 0 : (posSim - negSim) / total;
    
    scores.push({
      dimension: `${negative}-${positive}`,
      negative,
      positive,
      score,
    });
  }
  
  return scores;
}

function buildHaikuPrompt(scores: ConceptScore[], dominantColors?: string[], averageColor?: string): string {
  // Find the most prominent characteristics (strongest scores)
  const sortedScores = [...scores].sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
  const topTraits = sortedScores.slice(0, 5);
  
  // Build semantic description
  const traits = topTraits.map(s => {
    const intensity = Math.abs(s.score);
    const word = s.score > 0 ? s.positive : s.negative;
    if (intensity > 0.3) return `strongly ${word}`;
    if (intensity > 0.15) return word;
    return `slightly ${word}`;
  });
  
  // Color description
  let colorDesc = '';
  if (dominantColors && dominantColors.length > 0) {
    colorDesc = `\nDominant colors: ${dominantColors.slice(0, 3).join(', ')}`;
  }
  if (averageColor) {
    colorDesc += `\nOverall tone: ${averageColor}`;
  }
  
  return `You are a haiku poet channeling the machine's perception. 
A neural network analyzed an image and found these semantic qualities:
${traits.join(', ')}${colorDesc}

Write a single haiku (5-7-5 syllables) that captures these machine-perceived qualities poetically.
The haiku should feel like it emerged from the latent space—abstract yet evocative.
Do not describe literal objects. Instead, evoke the mood, texture, and essence.

Respond with ONLY the three lines of the haiku, nothing else.`;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;

  try {
    const openAiKey = process.env.OPENAI_API_KEY;
    if (!openAiKey) {
      return NextResponse.json(
        { error: 'OpenAI API key not configured' },
        { status: 500 }
      );
    }

    // Check if vector search is available
    const available = await isVectorSearchAvailable();
    if (!available) {
      return NextResponse.json(
        { error: 'Vector search not available. Ensure Redis Stack is running.' },
        { status: 503 }
      );
    }

    // Get the image's vectors from Redis
    const vectors = await getImageVectors(id);
    if (!vectors?.clipEmbedding) {
      return NextResponse.json(
        { error: 'Image does not have CLIP embedding. Generate embeddings first.' },
        { status: 404 }
      );
    }

    // Calculate concept scores
    const conceptScores = await getConceptScores(vectors.clipEmbedding);
    
    if (conceptScores.length === 0) {
      return NextResponse.json(
        { error: 'Failed to calculate concept scores' },
        { status: 500 }
      );
    }

    // Build prompt with color data if available
    const prompt = buildHaikuPrompt(
      conceptScores, 
      vectors.dominantColors, 
      vectors.averageColor
    );

    // Generate haiku using OpenAI
    const openAiResponse = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openAiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.9, // Higher temperature for more creative output
        max_tokens: 100,
        messages: [
          { role: 'user', content: prompt }
        ],
      }),
    });

    const aiResult = await openAiResponse.json();
    
    if (!openAiResponse.ok) {
      console.error('[Haiku] OpenAI error:', aiResult);
      return NextResponse.json(
        { error: aiResult.error?.message || 'Failed to generate haiku' },
        { status: 500 }
      );
    }

    const haiku = aiResult.choices?.[0]?.message?.content?.trim();
    
    if (!haiku) {
      return NextResponse.json(
        { error: 'Empty response from AI' },
        { status: 500 }
      );
    }

    // Parse into lines (should be 3 lines)
    const lines = haiku.split('\n').filter((line: string) => line.trim());
    
    return NextResponse.json({
      haiku,
      lines,
      conceptScores: conceptScores.slice(0, 5).map(s => ({
        trait: s.score > 0 ? s.positive : s.negative,
        intensity: Math.abs(s.score),
      })),
    });
  } catch (error) {
    console.error('[Haiku] Error:', error);
    return NextResponse.json(
      { error: 'Failed to generate haiku' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/images/[id]/haiku
 * 
 * Check if haiku generation is available for this image
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;

  try {
    const available = await isVectorSearchAvailable();
    if (!available) {
      return NextResponse.json({ available: false, reason: 'redis' });
    }

    const vectors = await getImageVectors(id);
    if (!vectors?.clipEmbedding) {
      return NextResponse.json({ available: false, reason: 'no-embedding' });
    }

    return NextResponse.json({ available: true });
  } catch {
    return NextResponse.json({ available: false, reason: 'error' });
  }
}
