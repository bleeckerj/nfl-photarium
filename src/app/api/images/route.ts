import { NextRequest, NextResponse } from 'next/server';
import { getCachedImages, getCacheStats } from '@/server/cloudflareImageCache';
import { getVideoAssetCatalogVersion, listVideoAssetRecordsWithSync } from '@/server/videoCatalogStorage';
import {
  getImageExtrasRecords,
  getImageExtrasSearchText,
  getImageFolderOverrides,
  getImageFolderOverridesVersion,
} from '@/server/imageExtras';
import { queryGalleryAssets, sortGalleryAssetsByUploadedDesc, type GalleryQueryAsset } from '@/server/galleryQuery';
import {
  parseAspectClasses,
  parseBooleanParam,
  parseCsvParam,
  parseEmbeddingFilter,
  toListableImage,
} from '@/server/galleryQueryRoute';
import { getScopedAssetAssembly } from '@/server/galleryScopeAssembly';
import { matchesAspectRatioClass, normalizeAspectRatioClass } from '@/utils/aspectRatioClass';
import {
  applyGalleryOptionalMetadata,
  loadGalleryOptionalMetadata,
} from '@/server/galleryOptionalMetadata';
import { analyzeGalleryDuplicates } from '@/server/galleryDuplicateAnalysis';
import {
  buildGalleryCollectionEtag,
  finalizeGalleryResponseDiagnostics,
  GALLERY_REVALIDATE_CACHE_CONTROL,
} from '@/server/galleryResponseDiagnostics';
import { randomUUID } from 'node:crypto';

export async function GET(request: NextRequest) {
  const startedAt = performance.now();
  const requestId = randomUUID();
  const mark = (value: number) => Number(value.toFixed(1));
  const timings: Record<string, number> = {};
  const diagnostics: Record<string, number | boolean | string | null> = {};
  const markStage = <T,>(label: string, fn: () => Promise<T> | T): Promise<T> | T => {
    const stageStartedAt = performance.now();
    const finalize = () => {
      timings[label] = mark(performance.now() - stageStartedAt);
    };
    try {
      const value = fn();
      if (value instanceof Promise) {
        return value.finally(finalize);
      }
      finalize();
      return value;
    } catch (error) {
      finalize();
      throw error;
    }
  };

  try {
    const forceRefresh = request.nextUrl.searchParams.get('refresh') === '1';
    const includeVectorMeta = request.nextUrl.searchParams.get('includeVectorMeta') === '1';
    const includeExtras = request.nextUrl.searchParams.get('includeExtras') === '1';
    const includeFamilyFor = request.nextUrl.searchParams.get('includeFamilyFor')?.trim() || '';
    const aspectRatioClass = request.nextUrl.searchParams.get('aspectRatioClass')?.trim();
    const aspectRatio = request.nextUrl.searchParams.get('aspectRatio')?.trim();
    const mediaFilter = request.nextUrl.searchParams.get('mediaFilter')?.trim().toLowerCase() || null;
    const search = request.nextUrl.searchParams.get('search')?.trim() || '';
    const folder = request.nextUrl.searchParams.get('folder')?.trim() || '';
    const tag = request.nextUrl.searchParams.get('tag')?.trim() || '';
    const onlyCanonical = parseBooleanParam(request.nextUrl.searchParams.get('onlyCanonical'));
    const onlyWithVariants = parseBooleanParam(request.nextUrl.searchParams.get('onlyWithVariants'));
    const favorites = parseBooleanParam(request.nextUrl.searchParams.get('favorites'));
    const duplicates = parseBooleanParam(request.nextUrl.searchParams.get('duplicates'));
    const includeDuplicateSummary =
      duplicates || request.nextUrl.searchParams.get('includeDuplicateSummary') === '1';
    const comfy = parseBooleanParam(request.nextUrl.searchParams.get('comfy'));
    const embedding = parseEmbeddingFilter(request.nextUrl.searchParams.get('embedding'));
    const aspectRatioClasses = parseAspectClasses(request.nextUrl.searchParams.get('aspectRatioClasses'));
    const normalizedAspectRatioClass = normalizeAspectRatioClass(aspectRatioClass);
    const dateStart = request.nextUrl.searchParams.get('dateStart')?.trim() || '';
    const dateEnd = request.nextUrl.searchParams.get('dateEnd')?.trim() || '';
    const dateTimeZone = request.nextUrl.searchParams.get('dateTimeZone')?.trim() || '';
    const hiddenFolders = parseCsvParam(request.nextUrl.searchParams.get('hiddenFolders'));
    const hiddenTags = parseCsvParam(request.nextUrl.searchParams.get('hiddenTags'));
    const hiddenNamespaces = parseCsvParam(request.nextUrl.searchParams.get('hiddenNamespaces'));
    const focusAssetId = request.nextUrl.searchParams.get('focus')?.trim() || '';
    const namespaceParam = request.nextUrl.searchParams.get('namespace');
    const videoLimitParam = request.nextUrl.searchParams.get('videoLimit');
    const pageParam = request.nextUrl.searchParams.get('page');
    const pageSizeParam = request.nextUrl.searchParams.get('pageSize');
    const defaultNamespace = process.env.IMAGE_NAMESPACE || process.env.NEXT_PUBLIC_IMAGE_NAMESPACE || '';
    const namespace =
      namespaceParam === '__none__'
        ? ''
        : namespaceParam === '__all__'
          ? null
          : namespaceParam !== null
            ? namespaceParam.trim()
            : defaultNamespace;
    // Kick off all three I/O-bound loads concurrently. They are independent:
    // the image cache, the video catalog, and the folder-override map do not
    // depend on each other's results. Awaiting them serially adds their
    // latencies together; awaiting them in parallel makes total I/O time
    // bounded by the slowest of the three. On a warm process all three are
    // ~tens of ms; on a cold process this saves whichever pair would have
    // run sequentially.
    const folderOverridesPromise = getImageFolderOverrides();
    folderOverridesPromise.catch((error) => {
      console.warn('[ImagesAPI] Folder override warm failed:', error);
    });

    const cachePromise = markStage('cache_load', () => getCachedImages(forceRefresh));

    const videoAssetsEnabled = process.env.ENABLE_VIDEO_ASSETS === '1';
    const configuredVideoLimit = Number(process.env.VIDEO_ASSET_LIST_LIMIT ?? 300);
    const parsedVideoLimit = videoLimitParam ? Number(videoLimitParam) : configuredVideoLimit;
    const videoLimit = Number.isFinite(parsedVideoLimit) && parsedVideoLimit > 0
      ? Math.floor(parsedVideoLimit)
      : 300;
    const videosPromise = videoAssetsEnabled
      ? markStage('videos_load', () => listVideoAssetRecordsWithSync())
      : Promise.resolve([] as Awaited<ReturnType<typeof listVideoAssetRecordsWithSync>>);

    const images = await cachePromise;
    const allVideos = await videosPromise;

    // Everything in the response body normally derives from three versioned
    // inputs: the image catalog, the folder-override map, and the video
    // catalog. With all three loads settled (and their background refresh
    // triggers fired, exactly as on a full response), an unchanged version
    // triple means a byte-identical response — answer 304 and skip assembly
    // entirely. Exception: requests that merge Redis-side color/aspect/
    // embedding metadata consume data with no version counter (background
    // embedding jobs mutate it), so they always get a full response.
    const consumesUnversionedMetadata =
      includeVectorMeta ||
      embedding !== 'none' ||
      aspectRatioClasses.length > 0 ||
      Boolean(normalizedAspectRatioClass || aspectRatio);
    await folderOverridesPromise.catch(() => null);
    const requestEtag = consumesUnversionedMetadata
      ? undefined
      : buildGalleryCollectionEtag('g1', [
          getCacheStats().contentVersion ?? 0,
          getImageFolderOverridesVersion(),
          getVideoAssetCatalogVersion(),
          request.nextUrl.search,
        ]);
    if (requestEtag && !forceRefresh && request.headers.get('if-none-match') === requestEtag) {
      timings.total = mark(performance.now() - startedAt);
      return new NextResponse(null, {
        status: 304,
        headers: {
          'Cache-Control': GALLERY_REVALIDATE_CACHE_CONTROL,
          ETag: requestEtag,
          'X-Photarium-Request-ID': requestId,
          'Server-Timing': `total;dur=${timings.total}`,
        },
      });
    }

    const parsedPage = pageParam ? Number(pageParam) : NaN;
    const parsedPageSize = pageSizeParam ? Number(pageSizeParam) : NaN;
    const hasPagination = Number.isFinite(parsedPage) || Number.isFinite(parsedPageSize);
    const page = Number.isFinite(parsedPage) && parsedPage > 0 ? Math.floor(parsedPage) : 1;
    const pageSize = Number.isFinite(parsedPageSize) && parsedPageSize > 0
      ? Math.min(500, Math.floor(parsedPageSize))
      : 60;
    const hasGalleryQueryParams = Boolean(
      search ||
      folder ||
      tag ||
      onlyCanonical ||
      onlyWithVariants ||
      favorites ||
      duplicates ||
      includeDuplicateSummary ||
      comfy ||
      embedding !== 'none' ||
      aspectRatioClasses.length > 0 ||
      dateStart ||
      dateEnd ||
      dateTimeZone ||
      hiddenFolders.length > 0 ||
      hiddenTags.length > 0 ||
      hiddenNamespaces.length > 0
    );
    const hasFocusQuery = Boolean(focusAssetId);
    // Folder filtering, hidden-folder filtering, and folder facets all need the
    // extras-stored folder for each image; the write-through in-memory map was
    // already awaited above for the ETag.
    const needsFolderOverrides = hasPagination || hasGalleryQueryParams || hasFocusQuery;
    const folderOverrides = needsFolderOverrides ? await folderOverridesPromise : null;
    diagnostics.query_extras_image_count = folderOverrides ? folderOverrides.size : 0;
    // Description / alt text / Prompt This / Comfy prompts live in extras, not
    // in the Cloudflare catalog, so the search haystack needs this projection
    // to reach them for the whole scope (the page-slice extras merge below
    // happens after filtering). Shares the folder-override load above.
    const extrasSearchTextById = search ? await getImageExtrasSearchText() : null;
    diagnostics.search_extras_text_count = extrasSearchTextById ? extrasSearchTextById.size : 0;

    const cacheStats = getCacheStats();
    const catalogVersion = cacheStats.contentVersion ?? cacheStats.lastFetched ?? 0;
    const catalogSource = cacheStats.source ?? (cacheStats.initialized ? 'memory' : 'empty');
    const lastReconciledAt = cacheStats.lastReconciledAt ?? cacheStats.lastFetched ?? 0;
    const scopeVersions = [
      catalogVersion,
      getImageFolderOverridesVersion(),
      getVideoAssetCatalogVersion(),
      namespace ?? '__all__',
      mediaFilter ?? '__none__',
      includeFamilyFor || '__none__',
      videoLimit,
      videoAssetsEnabled ? 'v1' : 'v0',
    ].join('|');
    const assembly = await markStage('scope_assembly', () =>
      getScopedAssetAssembly({
        cacheKey: `${scopeVersions}|overrides:${folderOverrides ? '1' : '0'}`,
        images,
        allVideos,
        namespace,
        mediaFilter,
        includeFamilyFor,
        videoLimit,
        folderOverrides,
      })
    );
    diagnostics.animated_webp_comfy_provenance_count = assembly.provenanceCount;
    diagnostics.filtered_image_count = assembly.filteredImageCount;
    diagnostics.video_scoped_count = assembly.videoScopedCount;
    diagnostics.video_returned_count = assembly.videoReturnedCount;
    const videoMeta = {
      enabled: videoAssetsEnabled,
      limit: videoLimit,
      returned: assembly.videoReturnedCount,
      totalScoped: assembly.videoScopedCount,
      truncated: assembly.videoScopedCount > assembly.videoReturnedCount,
    };
    diagnostics.family_asset_count = assembly.familyAssetCount;
    diagnostics.media_filter = mediaFilter;
    diagnostics.scoped_asset_count = assembly.scopedAssets.length;
    diagnostics.scoped_asset_count_before_media_filter = assembly.mergedScopedCount;
    const scopedImageIds = assembly.scopedImageIds;
    diagnostics.scoped_image_count = scopedImageIds.size;

    // Optional: merge embedding status from Redis.
    // Keep this off by default so gallery can render immediately and enrich asynchronously.
    // Note the scoped assets already carry folder overrides, so enrichment
    // spreads preserve them.
    let imagesWithEmbeddings = assembly.scopedAssets.filter(
      (asset) => asset.assetType !== 'video'
    ) as unknown as typeof images;
    const needsColorMetadata = includeVectorMeta || embedding !== 'none';
    const needsAspectMetadata =
      includeVectorMeta ||
      aspectRatioClasses.length > 0 ||
      Boolean(normalizedAspectRatioClass || aspectRatio);
    const optionalMetadata = await loadGalleryOptionalMetadata({
      imageIds: imagesWithEmbeddings.map((image) => image.id),
      needsColorMetadata,
      needsAspectMetadata,
    });
    Object.assign(timings, optionalMetadata.timings);
    Object.assign(diagnostics, optionalMetadata.diagnostics);

    imagesWithEmbeddings = applyGalleryOptionalMetadata(imagesWithEmbeddings, optionalMetadata);

    if (aspectRatioClasses.length > 0 || normalizedAspectRatioClass || aspectRatio) {
      const { hydrateMissingAspectMetadata } = await import('@/server/aspectMetadataHydration');
      imagesWithEmbeddings = (await hydrateMissingAspectMetadata(imagesWithEmbeddings)).images;
    }

    const enrichedImageMap = new Map(imagesWithEmbeddings.map((image) => [image.id, image]));
    const finalAssetsBeforeQuery = assembly.scopedAssets.map((asset) => {
      if (asset.assetType === 'video') {
        return asset;
      }
      return (enrichedImageMap.get(asset.id) as GalleryQueryAsset | undefined) ?? asset;
    });
    let finalImages: GalleryQueryAsset[] = finalAssetsBeforeQuery;
    if ((aspectRatioClass || aspectRatio) && aspectRatioClasses.length === 0) {
      finalImages = finalImages.filter((image) => {
        const entry = image as GalleryQueryAsset;
        if (aspectRatioClass) {
          return normalizedAspectRatioClass
            ? matchesAspectRatioClass(entry, [normalizedAspectRatioClass])
            : false;
        }
        if (aspectRatio) {
          return entry.aspectRatio === aspectRatio;
        }
        return true;
      });
    }

    diagnostics.pre_pagination_count = finalImages.length;
    // Stable scope key for queryGalleryAssets' family/facet/projection memos.
    // Same version-counted inputs as the assembly memo; per-request filters
    // (search, folder, tag, page, etc.) are applied AFTER the memoized stage.
    const scopeKey = `v3|${scopeVersions}`;
    const queryFilters = {
      search,
      folder,
      tag,
      onlyCanonical,
      onlyWithVariants,
      favorites,
      duplicates,
      comfy,
      embedding,
      aspectRatioClasses,
      dateStart,
      dateEnd,
      dateTimeZone,
      hiddenFolders,
      hiddenTags,
      hiddenNamespaces,
    };
    const precomputedDuplicateSummary = includeDuplicateSummary
      ? await markStage('duplicate_index', async () => {
          const duplicateScope = queryGalleryAssets<GalleryQueryAsset>(
            finalImages,
            { ...queryFilters, duplicates: false },
            1,
            Math.max(1, finalImages.length),
            undefined,
            scopeKey,
            { extrasSearchTextById: extrasSearchTextById ?? undefined }
          );
          return analyzeGalleryDuplicates(duplicateScope.images, {
            catalogVersion,
            scopeKey: JSON.stringify({
              namespace: namespace ?? '__all__',
              mediaFilter,
              includeFamilyFor,
              filters: { ...queryFilters, duplicates: false },
            }),
          });
        })
      : undefined;
    const queryResult = hasPagination || hasGalleryQueryParams || hasFocusQuery
      ? await markStage('gallery_query', () =>
          queryGalleryAssets<GalleryQueryAsset>(
            finalImages,
            queryFilters,
            page,
            hasPagination || hasFocusQuery ? pageSize : Math.max(1, finalImages.length),
            focusAssetId,
            scopeKey,
            {
              includeDuplicateSummary,
              precomputedDuplicateSummary,
              extrasSearchTextById: extrasSearchTextById ?? undefined,
            }
          )
        )
      : null;
    if (queryResult) Object.assign(timings, queryResult.timings);
    const totalBeforePagination = queryResult?.total ?? finalImages.length;
    if (queryResult && (hasPagination || hasGalleryQueryParams)) {
      finalImages = queryResult.images;
    } else if (!queryResult) {
      finalImages = sortGalleryAssetsByUploadedDesc(finalImages);
    }
    diagnostics.pagination_enabled = hasPagination;
    diagnostics.page = hasPagination && queryResult ? queryResult.page : null;
    diagnostics.page_size = hasPagination && queryResult ? queryResult.pageSize : null;
    diagnostics.total_before_pagination = totalBeforePagination;

    const imageIdsForExtras = finalImages
      .filter((asset) => (asset as { assetType?: string }).assetType !== 'video')
      .map((asset) => String((asset as { id: string }).id))
      .filter(Boolean);
    diagnostics.extras_image_count = includeExtras ? imageIdsForExtras.length : 0;
    // includeExtras requests merge full extras records into the response for
    // the page slice only -- typically ~60 ids, not the full scope. The
    // pre-pagination folder merge above does NOT pull full records anymore,
    // so we always need to MGET here when includeExtras is requested.
    const extrasById = includeExtras && imageIdsForExtras.length > 0
      ? await markStage('extras_load', () => getImageExtrasRecords(imageIdsForExtras))
      : {};

    const withExtrasApplied = includeExtras
      ? await markStage('extras_merge', () => finalImages.map((asset) => {
          const typed = asset as Record<string, unknown> & { id: string; assetType?: string };
          if (typed.assetType === 'video') return asset;
          const extras = extrasById[typed.id];
          if (!extras) return asset;

          const hasExtrasFolder = Object.prototype.hasOwnProperty.call(extras, 'folder');
          const extrasFolder = hasExtrasFolder && typeof extras.folder === 'string' ? extras.folder : undefined;
          const extrasDescription = typeof extras.description === 'string' ? extras.description : undefined;
          const extrasAltText = typeof extras.altText === 'string' ? extras.altText : undefined;
          const extrasSourceUrl = typeof extras.sourceUrl === 'string' ? extras.sourceUrl : undefined;
          const extrasSourceUrlNormalized =
            typeof extras.sourceUrlNormalized === 'string' ? extras.sourceUrlNormalized : undefined;
          const extrasOriginalUrl = typeof extras.originalUrl === 'string' ? extras.originalUrl : undefined;
          const extrasOriginalUrlNormalized =
            typeof extras.originalUrlNormalized === 'string' ? extras.originalUrlNormalized : undefined;

          return {
            ...typed,
            folder: hasExtrasFolder ? extrasFolder : typed.folder,
            description: extrasDescription ?? typed.description,
            sourceUrl: extrasSourceUrl ?? typed.sourceUrl,
            sourceUrlNormalized: extrasSourceUrlNormalized ?? typed.sourceUrlNormalized,
            originalUrl: extrasOriginalUrl ?? typed.originalUrl,
            originalUrlNormalized: extrasOriginalUrlNormalized ?? typed.originalUrlNormalized,
            altTag: extrasAltText ?? typed.altTag,
            altText: extrasAltText,
          };
        }))
      : finalImages;

    // The client re-applies the same search term to the page it receives, so a
    // hit that came from the extras projection has to travel with the asset --
    // otherwise the client filter would drop a row the server matched. Only
    // sent while a search is active, and only for assets that have extras text.
    const withSearchText = extrasSearchTextById
      ? withExtrasApplied.map((asset) => {
          const typed = asset as Record<string, unknown> & { id: string };
          const text = extrasSearchTextById.get(String(typed.id));
          return text ? { ...typed, searchText: text } : asset;
        })
      : withExtrasApplied;

    const cache = cacheStats;
    timings.persistent_read = cache.source === 'persistent' ? timings.cache_load ?? 0 : 0;
    const serializedImages = await markStage('serialization', () =>
      withSearchText.map((image) => toListableImage(image as Record<string, unknown>))
    );
    diagnostics.response_image_count = serializedImages.length;
    timings.total = mark(performance.now() - startedAt);
    const responseBody = {
      images: serializedImages,
      cache,
      namespace: namespace ?? null,
      videoMeta,
      timings,
      diagnostics,
      includeVectorMeta,
      includeExtras,
      includeDuplicateSummary,
      facets: queryResult?.facets ?? null,
      familySummaryMap: queryResult?.familySummaryMap ?? {},
      duplicateSummary: queryResult?.duplicateSummary ?? null,
      focus: queryResult?.focus ?? null,
      pagination: hasPagination || hasFocusQuery
        ? {
            page: queryResult?.page ?? page,
            pageSize: queryResult?.pageSize ?? pageSize,
            scopeTotal: queryResult?.scopeTotal ?? diagnostics.pre_pagination_count,
            total: totalBeforePagination,
            totalPages: queryResult?.totalPages ?? Math.max(1, Math.ceil(totalBeforePagination / pageSize)),
          }
        : null,
    };
    // Serialize once: the same string feeds both the payload-size diagnostic
    // and the response body.
    const serializedBody = JSON.stringify(responseBody);
    diagnostics.payload_kb = mark(Buffer.byteLength(serializedBody) / 1024);
    const response = new NextResponse(serializedBody, {
      headers: { 'content-type': 'application/json' },
    });
    finalizeGalleryResponseDiagnostics(response, {
      requestId, timings, diagnostics,
      cache: { ...cache, contentVersion: catalogVersion, source: catalogSource, lastReconciledAt },
      query: {
        includeVectorMeta, includeDuplicateSummary, forceRefresh,
        namespace: namespace ?? null, mediaFilter, videoLimit, includeFamilyFor,
      },
      // The tag computed before assembly, not current counters: if a version
      // bumped mid-request the stale tag just forces the next conditional
      // request to a full 200, which errs toward freshness.
      etag: requestEtag,
    });
    return response;
  } catch (error) {
    console.error('Fetch images error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
