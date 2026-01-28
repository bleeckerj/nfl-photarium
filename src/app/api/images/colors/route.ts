import { NextRequest, NextResponse } from 'next/server';
import { batchGetColorMetadata, isVectorSearchAvailable } from '@/server/vectorSearch';

/**
 * GET /api/images/colors?ids=id1,id2,id3
 * 
 * Fetches color metadata (dominant colors, average color) for multiple images.
 * Returns a map of imageId -> color metadata.
 */
export async function GET(request: NextRequest) {
  try {
    const idsParam = request.nextUrl.searchParams.get('ids');
    
    if (!idsParam) {
      return NextResponse.json(
        { error: 'Missing ids parameter' },
        { status: 400 }
      );
    }

    const imageIds = idsParam.split(',').filter(Boolean);
    
    if (imageIds.length === 0) {
      return NextResponse.json({ colors: {} });
    }

    // Check if Redis is available
    const available = await isVectorSearchAvailable();
    if (!available) {
      return NextResponse.json(
        { error: 'Vector search not available', colors: {} },
        { status: 503 }
      );
    }

    const colorMap = await batchGetColorMetadata(imageIds);

    // Convert Map to plain object for JSON serialization.
    // IMPORTANT: include ALL requested ids so the client can mark "missing" metadata
    // as fetched and avoid repeatedly re-requesting the same ids.
    const colors: Record<string, {
      dominantColors?: string[];
      averageColor?: string;
      hasClipEmbedding: boolean;
      hasColorEmbedding: boolean;
    }> = {};

    for (const imageId of imageIds) {
      const metadata = colorMap.get(imageId);
      colors[imageId] = {
        dominantColors: metadata?.dominantColors,
        averageColor: metadata?.averageColor,
        hasClipEmbedding: metadata?.hasClipEmbedding ?? false,
        hasColorEmbedding: metadata?.hasColorEmbedding ?? false,
      };
    }

    return NextResponse.json({ colors });
  } catch (error) {
    console.error('[ColorsAPI] Error fetching color metadata:', error);
    return NextResponse.json(
      { error: 'Failed to fetch color metadata', colors: {} },
      { status: 500 }
    );
  }
}
