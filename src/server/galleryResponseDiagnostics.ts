import { createHash, randomUUID } from 'node:crypto';

// The version counters behind gallery ETags (catalog contentVersion, folder
// override version, video catalog version) are per-process and reset to
// arbitrary values on restart, so a tag is only comparable against tags issued
// by the same process. Folding a per-process id into the tag makes any
// cross-process or cross-restart validation a guaranteed miss (a full 200),
// which errs toward freshness.
const SERVER_INSTANCE_ID = randomUUID().slice(0, 8);

export const buildGalleryCollectionEtag = (
  prefix: string,
  parts: Array<string | number>
): string => {
  const suffix = createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);
  return `W/"${prefix}-${SERVER_INSTANCE_ID}-${suffix}"`;
};

// "Store but always revalidate": the browser keeps the body and sends
// If-None-Match, so an unchanged dataset costs a 304 instead of a re-download,
// with zero staleness window.
export const GALLERY_REVALIDATE_CACHE_CONTROL = 'private, no-cache, must-revalidate';

type CacheDiagnostics = {
  count: number;
  contentVersion: number;
  source: string;
  lastReconciledAt: number;
  backgroundRefreshInProgress: boolean;
  lastReconcileDurationMs?: number;
  lastReconcileError?: string | null;
};

type GalleryQueryDiagnostics = {
  includeVectorMeta: boolean;
  includeDuplicateSummary: boolean;
  forceRefresh: boolean;
  namespace: string | null;
  mediaFilter: string | null;
  videoLimit: number;
  includeFamilyFor: string;
};

export const finalizeGalleryResponseDiagnostics = (
  response: Response,
  options: {
    requestId: string;
    timings: Record<string, number>;
    diagnostics: Record<string, number | boolean | string | null>;
    cache: CacheDiagnostics;
    query: GalleryQueryDiagnostics;
    etag?: string;
  }
) => {
  const { requestId, timings, diagnostics, cache, query, etag } = options;
  const ageMs =
    cache.lastReconciledAt > 0 ? Math.max(0, Date.now() - cache.lastReconciledAt) : 0;
  response.headers.set('Cache-Control', GALLERY_REVALIDATE_CACHE_CONTROL);
  if (etag) {
    response.headers.set('ETag', etag);
  }
  response.headers.set(
    'Server-Timing',
    Object.entries(timings).map(([name, duration]) => `${name};dur=${duration}`).join(', ')
  );
  response.headers.set('X-Photarium-Payload-KB', String(diagnostics.payload_kb));
  response.headers.set('X-Photarium-Request-ID', requestId);
  response.headers.set('X-Photarium-Catalog-Version', String(cache.contentVersion));
  response.headers.set('X-Photarium-Catalog-Source', cache.source);
  response.headers.set('X-Photarium-Catalog-Age-MS', String(ageMs));
  response.headers.set(
    'X-Photarium-Reconciling',
    cache.backgroundRefreshInProgress ? '1' : '0'
  );

  if ((timings.total ?? 0) >= 500) {
    console.warn('[ImagesAPI] Slow response', {
      requestId,
      totalMs: timings.total,
      timings,
      catalog: {
        count: cache.count,
        contentVersion: cache.contentVersion,
        source: cache.source,
        ageMs,
        reconciling: cache.backgroundRefreshInProgress,
        lastReconcileDurationMs: cache.lastReconcileDurationMs,
        lastReconcileError: cache.lastReconcileError,
      },
      scopedAssets: diagnostics.scoped_asset_count,
      extrasImages: diagnostics.extras_image_count,
      payloadKb: diagnostics.payload_kb,
      ...query,
    });
  }
};
