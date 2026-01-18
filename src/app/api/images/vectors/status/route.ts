/**
 * Vector Status API Route
 * 
 * GET /api/images/vectors/status
 * Returns status of vector search system and embedding progress
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCachedImages } from '@/server/cloudflareImageCache';
import {
  isVectorSearchAvailable,
  getIndexStats,
  ensureVectorIndex,
} from '@/server/vectorSearch';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const available = await isVectorSearchAvailable();
    
    if (!available) {
      return NextResponse.json({
        available: false,
        error: 'Vector search not available. Ensure Redis Stack is running.',
        help: 'Run: npm run redis:start',
      });
    }

    // Ensure index exists
    await ensureVectorIndex();

    // Get index stats
    const stats = await getIndexStats();

    // Get total image count
    const images = await getCachedImages();
    const totalImages = images.length;

    // Count images with embeddings (from cache flags)
    const withClip = images.filter(img => img.hasClipEmbedding).length;
    const withColor = images.filter(img => img.hasColorEmbedding).length;

    return NextResponse.json({
      available: true,
      indexName: 'idx:images',
      stats: {
        totalImages,
        indexedInRedis: stats?.totalImages ?? 0,
        withClipEmbedding: withClip,
        withColorEmbedding: withColor,
        clipProgress: totalImages > 0 ? `${Math.round(withClip / totalImages * 100)}%` : '0%',
        colorProgress: totalImages > 0 ? `${Math.round(withColor / totalImages * 100)}%` : '0%',
      },
      needsEmbedding: totalImages - withClip,
    });
  } catch (error) {
    console.error('[API] Error getting vector status:', error);
    return NextResponse.json(
      { error: 'Failed to get vector status', details: String(error) },
      { status: 500 }
    );
  }
}

// POST to trigger index creation
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const available = await isVectorSearchAvailable();
    
    if (!available) {
      return NextResponse.json({
        error: 'Vector search not available. Ensure Redis Stack is running.',
      }, { status: 503 });
    }

    await ensureVectorIndex();

    return NextResponse.json({
      success: true,
      message: 'Vector index created/verified',
    });
  } catch (error) {
    console.error('[API] Error creating vector index:', error);
    return NextResponse.json(
      { error: 'Failed to create vector index', details: String(error) },
      { status: 500 }
    );
  }
}
