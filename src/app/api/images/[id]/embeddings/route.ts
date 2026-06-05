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
  applyEmbeddingReadinessToImage,
  assessEmbeddingReadiness,
  needsCachedEmbeddingUpdate,
  pickEmbeddingImageUrl,
} from '@/server/embeddingRequestService';
import {
  storeImageVectors,
  isVectorSearchAvailable,
  ensureVectorIndex,
  getImageVectors,
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

    const existingVectors = await getImageVectors(id);
    const readiness = assessEmbeddingReadiness(image, existingVectors, {
      generateClip,
      generateColor,
      force,
    });

    if (!readiness.needsClip && !readiness.needsColor) {
      if (needsCachedEmbeddingUpdate(image, readiness)) {
        await upsertCachedImage(applyEmbeddingReadinessToImage(image, readiness));
      }
      return NextResponse.json({
        imageId: id,
        message: 'Embeddings already exist',
        hasClipEmbedding: readiness.hasClipEmbedding,
        hasColorEmbedding: readiness.hasColorEmbedding,
        dominantColors: readiness.dominantColors,
        averageColor: readiness.averageColor,
        skipped: true,
      });
    }

    // Get image URL (use w=300 variant for efficiency)
    const imageUrl = pickEmbeddingImageUrl(image);
    if (!imageUrl) {
      return NextResponse.json(
        { error: 'Image has no variants' },
        { status: 400 }
      );
    }

    let clipEmbedding: number[] | null = null;
    let colorInfo: Awaited<ReturnType<typeof extractColorsFromUrl>> = null;

    // Generate CLIP embedding
    if (readiness.needsClip) {
      clipEmbedding = await generateClipEmbedding(imageUrl);
    }

    // Generate color embedding
    if (readiness.needsColor) {
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
      const nextHasClip = Boolean(clipEmbedding) || readiness.hasClipEmbedding;
      const nextHasColor = Boolean(colorInfo) || readiness.hasColorEmbedding;
      await upsertCachedImage({
        ...image,
        hasClipEmbedding: nextHasClip,
        hasColorEmbedding: nextHasColor,
        dominantColors: colorInfo?.dominantColors ?? readiness.dominantColors,
        averageColor: colorInfo?.averageColor ?? readiness.averageColor,
      });
    }

    return NextResponse.json({
      imageId: id,
      success: true,
      clipGenerated: !!clipEmbedding,
      colorGenerated: !!colorInfo,
      hasClipEmbedding: Boolean(clipEmbedding) || readiness.hasClipEmbedding,
      hasColorEmbedding: Boolean(colorInfo) || readiness.hasColorEmbedding,
      dominantColors: colorInfo?.dominantColors ?? readiness.dominantColors,
      averageColor: colorInfo?.averageColor ?? readiness.averageColor,
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

    const redisAvailable = await isVectorSearchAvailable();
    const vectors = redisAvailable ? await getImageVectors(id) : null;
    const hasStoredClip = Boolean(vectors?.clipEmbedding?.length);
    const hasStoredColor = Boolean(vectors?.colorHistogram?.length);

    return NextResponse.json({
      imageId: id,
      hasClipEmbedding: hasStoredClip || Boolean(image.hasClipEmbedding),
      hasColorEmbedding: hasStoredColor || Boolean(image.hasColorEmbedding),
      dominantColors: vectors?.dominantColors ?? image.dominantColors,
      averageColor: vectors?.averageColor ?? image.averageColor,
      source: hasStoredClip || hasStoredColor ? 'redis' : 'cache',
    });
  } catch (error) {
    console.error('[API] Error getting embedding status:', error);
    return NextResponse.json(
      { error: 'Failed to get embedding status' },
      { status: 500 }
    );
  }
}
