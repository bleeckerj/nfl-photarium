/**
 * Batch Embeddings API Route
 * 
 * POST /api/images/embeddings/batch
 * Generate embeddings for multiple images at once
 * 
 * Request body:
 *   - imageIds: string[] - Array of image IDs to process
 *   - clip: boolean (default: true) - Generate CLIP embeddings
 *   - color: boolean (default: true) - Generate color embeddings
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

interface BatchRequest {
  imageIds: string[];
  clip?: boolean;
  color?: boolean;
  force?: boolean;
}

interface BatchResult {
  imageId: string;
  success: boolean;
  clipGenerated?: boolean;
  colorGenerated?: boolean;
  skipped?: boolean;
  error?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
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

    // Parse request body
    const body = await request.json() as BatchRequest;
    const { imageIds } = body;

    if (!imageIds || !Array.isArray(imageIds) || imageIds.length === 0) {
      return NextResponse.json(
        { error: 'Missing or empty imageIds array' },
        { status: 400 }
      );
    }

    // Limit batch size to prevent timeouts
    const MAX_BATCH_SIZE = 50;
    if (imageIds.length > MAX_BATCH_SIZE) {
      return NextResponse.json(
        { error: `Batch size exceeds maximum of ${MAX_BATCH_SIZE}. Process in smaller batches.` },
        { status: 400 }
      );
    }

    const generateClip = body.clip !== false;
    const generateColor = body.color !== false;
    const force = body.force === true;

    const results: BatchResult[] = [];
    let successCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const imageId of imageIds) {
      try {
        // Get the image
        const image = await getCachedImage(imageId);
        if (!image) {
          results.push({ imageId, success: false, error: 'Image not found' });
          errorCount++;
          continue;
        }

        // Check if we need to do anything
        const needsClip = generateClip && (force || !image.hasClipEmbedding);
        const needsColor = generateColor && (force || !image.hasColorEmbedding);

        if (!needsClip && !needsColor) {
          results.push({ imageId, success: true, skipped: true });
          skippedCount++;
          continue;
        }

        // Get image URL
        const variant = image.variants.find(v => v.includes('w=300')) || image.variants[0];
        const imageUrl = `${variant}?format=webp`;

        let clipEmbedding: number[] | null = null;
        let colorInfo: Awaited<ReturnType<typeof extractColorsFromUrl>> = null;

        // Generate embeddings
        if (needsClip) {
          clipEmbedding = await generateClipEmbedding(imageUrl);
        }

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

        results.push({
          imageId,
          success: true,
          clipGenerated: !!clipEmbedding,
          colorGenerated: !!colorInfo,
        });
        successCount++;

        // Small delay between images to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 50));
      } catch (error) {
        results.push({
          imageId,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        errorCount++;
      }
    }

    return NextResponse.json({
      total: imageIds.length,
      success: successCount,
      skipped: skippedCount,
      errors: errorCount,
      results,
    });
  } catch (error) {
    console.error('[API] Error in batch embeddings:', error);
    return NextResponse.json(
      { error: 'Failed to process batch', details: String(error) },
      { status: 500 }
    );
  }
}
