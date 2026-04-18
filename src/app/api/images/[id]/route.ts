import { NextRequest, NextResponse } from 'next/server';
import {
  type CachedCloudflareImage,
  getCachedImage,
  transformApiImageToCached,
  upsertCachedImage
} from '@/server/cloudflareImageCache';
import { fetchCloudflareImage, getCloudflareCredentials } from '@/server/cloudflareClient';
import { probeAnimatedImageFromOriginalBlob } from '@/server/animatedImageProbe';
import { cleanupImageArtifacts } from '@/server/imageArtifactCleanup';
import { deleteStreamVideo } from '@/server/cloudflareStreamClient';
import {
  batchGetAspectMetadata,
  batchGetColorMetadata,
  isVectorSearchAvailable,
} from '@/server/vectorSearch';
import {
  deleteVideoAssetRecord,
  getVideoAssetRecord,
} from '@/server/videoCatalogStorage';

const pickVariantUrl = (variants: string[] | undefined): string | undefined => {
  if (!Array.isArray(variants) || variants.length === 0) return undefined;
  return variants.find((url) => url.includes('/public')) || variants[0];
};

const parseSize = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return undefined;
};

const readKnownSize = (image: CachedCloudflareImage): number | undefined => {
  if (typeof image.size === 'number' && Number.isFinite(image.size) && image.size >= 0) {
    return image.size;
  }
  const meta = image as unknown as { meta?: Record<string, unknown> };
  const metadata = meta.meta;
  if (!metadata || typeof metadata !== 'object') return undefined;
  return (
    parseSize(metadata.size)
    || parseSize(metadata.bytes)
    || parseSize(metadata.fileSize)
  );
};

const parseContentRangeTotal = (value: string | null): number | undefined => {
  if (!value) return undefined;
  const match = value.match(/\/(\d+)$/);
  if (!match) return undefined;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const fetchSizeFromVariant = async (url: string): Promise<number | undefined> => {
  try {
    const head = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    const headerSize = parseSize(head.headers.get('content-length'));
    if (headerSize !== undefined) return headerSize;
  } catch {
    // Continue to range fallback.
  }

  try {
    const range = await fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      cache: 'no-store'
    });
    const fromLength = parseSize(range.headers.get('content-length'));
    const fromRange = parseContentRangeTotal(range.headers.get('content-range'));
    return fromRange ?? fromLength;
  } catch {
    return undefined;
  }
};

const enrichImageSize = async (image: CachedCloudflareImage): Promise<CachedCloudflareImage> => {
  const known = readKnownSize(image);
  if (known !== undefined) {
    return { ...image, size: known };
  }
  const variantUrl = pickVariantUrl(image.variants);
  if (!variantUrl) return image;
  const discoveredSize = await fetchSizeFromVariant(variantUrl);
  if (discoveredSize === undefined) return image;
  return { ...image, size: discoveredSize };
};

const hasAnimatedTag = (tags: string[] | undefined) =>
  Array.isArray(tags) && tags.some((tag) => tag.trim().toLowerCase() === 'animated-webp');

const shouldProbeAnimatedState = (image: CachedCloudflareImage) => {
  if (image.isAnimated === true) return false;
  if (hasAnimatedTag(image.tags)) return false;
  if (typeof image.contentType === 'string' && image.contentType.trim().toLowerCase() === 'image/webp') {
    return true;
  }
  return image.filename.trim().toLowerCase().endsWith('.webp');
};

const enrichAnimatedState = async (image: CachedCloudflareImage): Promise<CachedCloudflareImage> => {
  if (!shouldProbeAnimatedState(image)) {
    return image;
  }

  try {
    const probe = await probeAnimatedImageFromOriginalBlob(image.id);
    if (!probe.isAnimated && !probe.contentType) {
      return image;
    }
    return {
      ...image,
      isAnimated: probe.isAnimated || image.isAnimated,
      contentType: probe.contentType ?? image.contentType,
    };
  } catch (error) {
    console.warn('[SingleImage] Animated probe failed:', { imageId: image.id, error });
    return image;
  }
};

const mark = (value: number) => Number(value.toFixed(1));

const enrichWithVectorMetadata = async (
  image: CachedCloudflareImage
): Promise<CachedCloudflareImage> => {
  const redisAvailable = await isVectorSearchAvailable();
  if (!redisAvailable) {
    return image;
  }

  const [colorMetadata, aspectMetadata] = await Promise.all([
    batchGetColorMetadata([image.id]),
    batchGetAspectMetadata([image.id]),
  ]);

  const color = colorMetadata.get(image.id);
  const aspect = aspectMetadata.get(image.id);
  if (!color && !aspect) {
    return image;
  }

  return {
    ...image,
    hasClipEmbedding: color?.hasClipEmbedding ?? image.hasClipEmbedding,
    hasColorEmbedding: color?.hasColorEmbedding ?? image.hasColorEmbedding,
    dominantColors: color?.dominantColors ?? image.dominantColors,
    averageColor: color?.averageColor ?? image.averageColor,
    aspectRatio: aspect?.aspectRatio ?? image.aspectRatio,
    dimensions: aspect?.width && aspect?.height
      ? { width: aspect.width, height: aspect.height }
      : image.dimensions,
  };
};

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: imageId } = await params;
   
    if (!imageId) {
      return NextResponse.json(
        { error: 'Image ID is required' },
        { status: 400 }
      );
    }

    const videoRecord = await getVideoAssetRecord(imageId);
    if (videoRecord) {
      try {
        await deleteStreamVideo(videoRecord.streamUid);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.toLowerCase().includes('not found') && !message.toLowerCase().includes('(404)')) {
          console.error('[VideoDelete] Stream API error:', error);
          return NextResponse.json(
            { error: 'Failed to delete video from Cloudflare Stream' },
            { status: 502 }
          );
        }
      }

      await deleteVideoAssetRecord(imageId);
      const cleanup = await cleanupImageArtifacts(imageId);
      if (!cleanup.success) {
        console.warn('[VideoDelete] Local artifact cleanup had failures', {
          imageId,
          steps: cleanup.steps,
        });
      }

      return NextResponse.json({ success: true, assetType: 'video' });
    }

    const { accountId, apiToken } = getCloudflareCredentials();

    // Delete image from Cloudflare
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1/${imageId}`,
      {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
        },
      }
    );

    const result = await response.json().catch(() => null);

    if (!response.ok && response.status !== 404) {
      console.error('Cloudflare API error:', result);
      return NextResponse.json(
        { error: result?.errors?.[0]?.message || 'Failed to delete image from Cloudflare' },
        { status: response.status }
      );
    }

    const cleanup = await cleanupImageArtifacts(imageId);
    if (!cleanup.success) {
      console.warn('[ImageDelete] Local artifact cleanup had failures', {
        imageId,
        steps: cleanup.steps,
      });
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Delete image error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startedAt = performance.now();
  const timings: Record<string, number> = {};
  const diagnostics: Record<string, number | boolean | string | null> = {};

  try {
    const { id: imageId } = await params;
    if (!imageId) {
      return NextResponse.json({ error: 'Image ID is required' }, { status: 400 });
    }

    const cacheStartedAt = performance.now();
    const cached = await getCachedImage(imageId);
    timings.cache_lookup = mark(performance.now() - cacheStartedAt);
    if (cached) {
      let responseImage = cached;
      const animatedProbeStartedAt = performance.now();
      responseImage = await enrichAnimatedState(responseImage);
      timings.animated_probe = mark(performance.now() - animatedProbeStartedAt);
      if (responseImage !== cached) {
        upsertCachedImage(responseImage);
      }
      try {
        const vectorStartedAt = performance.now();
        responseImage = await enrichWithVectorMetadata(responseImage);
        timings.vector_enrich = mark(performance.now() - vectorStartedAt);
        if (responseImage !== cached) {
          upsertCachedImage(responseImage);
        }
      } catch (error) {
        console.warn('[SingleImage] Vector metadata enrichment failed:', { imageId, error });
      }
      diagnostics.source = 'cache';
      diagnostics.had_known_size = typeof readKnownSize(responseImage) === 'number';
      if (typeof readKnownSize(responseImage) !== 'number') {
        void enrichImageSize(responseImage).then((enriched) => {
          if ((responseImage.size ?? null) !== (enriched.size ?? null)) {
            upsertCachedImage(enriched);
          }
        }).catch((error) => {
          console.warn('[SingleImage] Background size enrichment failed', { imageId, error });
        });
      }
      timings.total = mark(performance.now() - startedAt);
      const response = NextResponse.json({
        image: { ...responseImage, fileSizeBytes: responseImage.size ?? null },
        timings,
        diagnostics,
      });
      response.headers.set(
        'Server-Timing',
        Object.entries(timings)
          .map(([name, duration]) => `${name};dur=${duration}`)
          .join(', ')
      );
      return response;
    }

    const cloudflareStartedAt = performance.now();
    const image = await fetchCloudflareImage(imageId);
    timings.cloudflare_fetch = mark(performance.now() - cloudflareStartedAt);
    diagnostics.source = 'cloudflare';
    const transformed = transformApiImageToCached(image);
    let responseImage = await enrichAnimatedState(transformed);
    try {
      const vectorStartedAt = performance.now();
      responseImage = await enrichWithVectorMetadata(responseImage);
      timings.vector_enrich = mark(performance.now() - vectorStartedAt);
    } catch (error) {
      console.warn('[SingleImage] Vector metadata enrichment failed:', { imageId, error });
    }
    diagnostics.had_known_size = typeof readKnownSize(transformed) === 'number';
    upsertCachedImage(responseImage);
    if (typeof readKnownSize(responseImage) !== 'number') {
      void enrichImageSize(responseImage).then((enriched) => {
        if ((responseImage.size ?? null) !== (enriched.size ?? null)) {
          upsertCachedImage(enriched);
        }
      }).catch((error) => {
        console.warn('[SingleImage] Background size enrichment failed', { imageId, error });
      });
    }

    timings.total = mark(performance.now() - startedAt);
    const response = NextResponse.json({
      image: { ...responseImage, fileSizeBytes: responseImage.size ?? null },
      timings,
      diagnostics,
    });
    response.headers.set(
      'Server-Timing',
      Object.entries(timings)
        .map(([name, duration]) => `${name};dur=${duration}`)
        .join(', ')
    );
    return response;
  } catch (error) {
    console.error('Fetch single image error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
