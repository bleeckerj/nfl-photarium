/**
 * Generate Embeddings API Route
 * 
 * POST /api/images/[id]/embeddings
 * Generate CLIP and/or color embeddings for a specific image
 * 
 * Request body (optional):
 *   - clip: boolean (default: true) - Generate CLIP embedding
 *   - color: boolean (default: true) - Generate color embedding
 *   - force: boolean (default: false) - Regenerate even if exists
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCachedImage, upsertCachedImage } from '@/server/cloudflareImageCache';
import { generateClipEmbedding } from '@/server/embeddingService';
import { extractColorsFromUrl } from '@/server/colorExtraction';
import {
  storeImageVectors,
  isVectorSearchAvailable,
  ensureVectorIndex,
} from '@/server/vectorSearch';

interface EmbeddingRequest {
  clip?: boolean;
  color?: boolean;
  force?: boolean;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;

  try {
    // Check if vector search is available
    const available = await isVectorSearchAvailable();
    if (!available) {
      return NextResponse.json(
        { error: 'Vector search not available. Ensure Redis Stack is running.' },
        { status: 503 }
      );
    }

    // Ensure index exists
    await ensureVectorIndex();

    // Get the image
    const image = await getCachedImage(id);
    if (!image) {
      return NextResponse.json(
        { error: 'Image not found' },
        { status: 404 }
      );
    }

    // Parse request body
    let body: EmbeddingRequest = {};
    try {
      body = await request.json();
    } catch {
      // Empty body is fine, use defaults
    }

    const generateClip = body.clip !== false;
    const generateColor = body.color !== false;
    const force = body.force === true;

    // Check if we need to do anything
    const needsClip = generateClip && (force || !image.hasClipEmbedding);
    const needsColor = generateColor && (force || !image.hasColorEmbedding);

    if (!needsClip && !needsColor) {
      return NextResponse.json({
        imageId: id,
        message: 'Embeddings already exist',
        hasClipEmbedding: image.hasClipEmbedding,
        hasColorEmbedding: image.hasColorEmbedding,
        skipped: true,
      });
    }

    // Get image URL (use w=300 variant for efficiency)
    const variant = image.variants.find(v => v.includes('w=300')) || image.variants[0];
    const imageUrl = `${variant}?format=webp`;

    let clipEmbedding: number[] | null = null;
    let colorInfo: Awaited<ReturnType<typeof extractColorsFromUrl>> = null;

    // Generate CLIP embedding
    if (needsClip) {
      clipEmbedding = await generateClipEmbedding(imageUrl);
    }

    // Generate color embedding
    if (needsColor) {
      colorInfo = await extractColorsFromUrl(imageUrl);
    }

    // Store in Redis
    if (clipEmbedding || colorInfo) {
      await storeImageVectors({
        imageId: image.id,
        filename: image.filename,
        folder: image.folder,
        clipEmbedding: clipEmbedding ?? undefined,
        colorHistogram: colorInfo?.histogram,
        dominantColors: colorInfo?.dominantColors,
        averageColor: colorInfo?.averageColor,
      });

      // Update cache flags
      await upsertCachedImage({
        ...image,
        hasClipEmbedding: clipEmbedding ? true : image.hasClipEmbedding,
        hasColorEmbedding: colorInfo ? true : image.hasColorEmbedding,
        dominantColors: colorInfo?.dominantColors ?? image.dominantColors,
        averageColor: colorInfo?.averageColor ?? image.averageColor,
      });
    }

    return NextResponse.json({
      imageId: id,
      success: true,
      clipGenerated: !!clipEmbedding,
      colorGenerated: !!colorInfo,
      hasClipEmbedding: clipEmbedding ? true : image.hasClipEmbedding,
      hasColorEmbedding: colorInfo ? true : image.hasColorEmbedding,
      dominantColors: colorInfo?.dominantColors ?? image.dominantColors,
      averageColor: colorInfo?.averageColor ?? image.averageColor,
    });
  } catch (error) {
    console.error('[API] Error generating embeddings:', error);
    return NextResponse.json(
      { error: 'Failed to generate embeddings', details: String(error) },
      { status: 500 }
    );
  }
}

// GET to check embedding status for this image
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;

  try {
    const image = await getCachedImage(id);
    if (!image) {
      return NextResponse.json(
        { error: 'Image not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      imageId: id,
      hasClipEmbedding: image.hasClipEmbedding ?? false,
      hasColorEmbedding: image.hasColorEmbedding ?? false,
      dominantColors: image.dominantColors,
      averageColor: image.averageColor,
    });
  } catch (error) {
    console.error('[API] Error getting embedding status:', error);
    return NextResponse.json(
      { error: 'Failed to get embedding status' },
      { status: 500 }
    );
  }
}
