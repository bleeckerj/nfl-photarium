import { NextRequest, NextResponse } from 'next/server';
import {
  type CachedCloudflareImage,
  getCachedImage,
  transformApiImageToCached,
  upsertCachedImage
} from '@/server/cloudflareImageCache';
import { fetchCloudflareImage } from '@/server/cloudflareClient';
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
  listVideoAssetRecords,
} from '@/server/videoCatalogStorage';
import { getImageExtrasRecord } from '@/server/imageExtras';
import {
  applyVideoAnimatedWebpComfyProvenance,
  buildVideoAnimatedWebpComfyProvenanceMap,
} from '@/server/videoAnimatedWebpComfyProvenance';
import { detachAssetChildren, ParentAssignmentError } from '@/server/assetParentService';
import {
  CloudflareImageDeleteError,
  deleteCloudflareImageAsset,
} from '@/server/cloudflareImageDeletion';

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

const mayBeVideoAnimatedWebpDerivative = (image: CachedCloudflareImage) => {
  if (image.isAnimated === true || hasAnimatedTag(image.tags)) return true;
  if (typeof image.contentType === 'string' && image.contentType.trim().toLowerCase() === 'image/webp') return true;
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

const enrichWithVideoAnimatedWebpComfyProvenance = async (
  image: CachedCloudflareImage
): Promise<CachedCloudflareImage> => {
  if (image.generatedBy === 'comfyui' || image.comfyMetadataDetected === true || image.comfyMetadataSource) {
    return image;
  }
  if (!mayBeVideoAnimatedWebpDerivative(image)) {
    return image;
  }
  const videos = await listVideoAssetRecords();
  const provenance = buildVideoAnimatedWebpComfyProvenanceMap(videos);
  return applyVideoAnimatedWebpComfyProvenance([image], provenance)[0] ?? image;
};

const toExifSummary = (value: unknown): Record<string, string | number> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const candidate =
    record.summary && typeof record.summary === 'object' && !Array.isArray(record.summary)
      ? (record.summary as Record<string, unknown>)
      : record;
  const entries = Object.entries(candidate).filter(
    (entry): entry is [string, string | number] =>
      typeof entry[1] === 'string' || typeof entry[1] === 'number'
  );

  return entries.length ? Object.fromEntries(entries) : undefined;
};

const applyExtrasMetadata = async (image: CachedCloudflareImage) => {
  const extras = await getImageExtrasRecord(image.id);
  if (!extras) return image;

  const next = { ...image };
  if (Object.prototype.hasOwnProperty.call(extras, 'folder')) {
    next.folder = extras.folder;
  }
  if (Object.prototype.hasOwnProperty.call(extras, 'description')) {
    next.description = extras.description;
  }
  if (Object.prototype.hasOwnProperty.call(extras, 'altText')) {
    next.altTag = extras.altText;
  }
  const exif = toExifSummary(extras.exif);
  if (exif) {
    next.exif = exif;
  }
  if (extras.animatedWebp) {
    next.animatedWebp = extras.animatedWebp;
  }
  return next;
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

    let detachedChildIds: string[] = [];
    try {
      // Single-image delete must not block on a full Cloudflare catalog refresh.
      // The delete call below is authoritative; this warm-catalog pass only detaches known children.
      const detachResult = await detachAssetChildren(imageId, {
        forceRefreshImages: false,
        includeVideos: process.env.ENABLE_VIDEO_ASSETS === '1',
      });
      detachedChildIds = detachResult.detachedIds;
      if (detachResult.failed.length > 0) {
        return NextResponse.json(
          {
            error: 'Failed to detach one or more child variants before deleting parent image',
            failed: detachResult.failed,
            detachedIds: detachResult.detachedIds,
          },
          { status: 502 }
        );
      }
    } catch (error) {
      const parentError = error instanceof ParentAssignmentError ? error : null;
      console.error('[ImageDelete] Failed to detach child variants before parent delete:', error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Failed to detach child variants before delete' },
        { status: parentError?.status ?? 500 }
      );
    }

    try {
      await deleteCloudflareImageAsset(imageId);
    } catch (error) {
      const cloudflareError = error instanceof CloudflareImageDeleteError ? error : null;
      console.error('Cloudflare API error:', error);
      return NextResponse.json(
        {
          error: error instanceof Error ? error.message : 'Failed to delete image from Cloudflare',
        },
        { status: cloudflareError?.status ?? 502 }
      );
    }

    const cleanup = await cleanupImageArtifacts(imageId);
    if (!cleanup.success) {
      console.warn('[ImageDelete] Local artifact cleanup had failures', {
        imageId,
        steps: cleanup.steps,
      });
    }

    return NextResponse.json({ success: true, detachedChildIds });

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

    const forceRefresh = request.nextUrl.searchParams.get('refresh') === '1';
    const includeVectorMeta = request.nextUrl.searchParams.get('includeVectorMeta') === '1';
    const includeBlockingEnrichment = request.nextUrl.searchParams.get('enrich') === '1';
    let baseImage: CachedCloudflareImage | undefined;
    let shouldPersistResponseImage = false;

    if (!forceRefresh) {
      const cacheStartedAt = performance.now();
      baseImage = await getCachedImage(imageId);
      timings.cache_lookup = mark(performance.now() - cacheStartedAt);
      if (baseImage) {
        diagnostics.source = 'cache';
      }
    }

    if (!baseImage || forceRefresh) {
      const cloudflareStartedAt = performance.now();
      try {
        const image = await fetchCloudflareImage(imageId);
        timings.cloudflare_fetch = mark(performance.now() - cloudflareStartedAt);
        diagnostics.source = 'cloudflare';
        diagnostics.refresh = forceRefresh;
        baseImage = transformApiImageToCached(image);
        shouldPersistResponseImage = true;
      } catch (error) {
        timings.cloudflare_fetch = mark(performance.now() - cloudflareStartedAt);
        diagnostics.cloudflare_error = error instanceof Error ? error.message : String(error);

        if (forceRefresh) {
          const cacheStartedAt = performance.now();
          const cached = await getCachedImage(imageId);
          timings.cache_lookup = mark(performance.now() - cacheStartedAt);
          if (cached) {
            diagnostics.source = 'cache';
            diagnostics.cloudflare_fallback = true;
            baseImage = cached;
          }
        }

        if (!baseImage) {
          throw error;
        }
      }
    }

    let responseImage = baseImage;
    if (includeBlockingEnrichment || forceRefresh) {
      const animatedProbeStartedAt = performance.now();
      responseImage = await enrichAnimatedState(responseImage);
      timings.animated_probe = mark(performance.now() - animatedProbeStartedAt);
      if (responseImage !== baseImage) {
        shouldPersistResponseImage = true;
      }
    } else {
      diagnostics.animated_probe_deferred = shouldProbeAnimatedState(responseImage);
    }

    if (includeVectorMeta || includeBlockingEnrichment) {
      try {
        const vectorStartedAt = performance.now();
        responseImage = await enrichWithVectorMetadata(responseImage);
        timings.vector_enrich = mark(performance.now() - vectorStartedAt);
        if (responseImage !== baseImage) {
          shouldPersistResponseImage = true;
        }
      } catch (error) {
        console.warn('[SingleImage] Vector metadata enrichment failed:', { imageId, error });
      }
    } else {
      diagnostics.vector_enrich_deferred = true;
    }

    const videoProvenanceStartedAt = performance.now();
    responseImage = await enrichWithVideoAnimatedWebpComfyProvenance(responseImage);
    timings.video_comfy_provenance = mark(performance.now() - videoProvenanceStartedAt);

    diagnostics.had_known_size = typeof readKnownSize(responseImage) === 'number';
    if (shouldPersistResponseImage) {
      upsertCachedImage(responseImage);
    }
    if (typeof readKnownSize(responseImage) !== 'number') {
      void enrichImageSize(responseImage).then((enriched) => {
        if ((responseImage.size ?? null) !== (enriched.size ?? null)) {
          upsertCachedImage(enriched);
        }
      }).catch((error) => {
        console.warn('[SingleImage] Background size enrichment failed', { imageId, error });
      });
    }

    const extrasStartedAt = performance.now();
    const responseImageWithExtras = await applyExtrasMetadata(responseImage);
    timings.extras_load = mark(performance.now() - extrasStartedAt);

    timings.total = mark(performance.now() - startedAt);
    const response = NextResponse.json({
      image: { ...responseImageWithExtras, fileSizeBytes: responseImageWithExtras.size ?? null },
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
