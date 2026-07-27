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
  }
) => {
  const { requestId, timings, diagnostics, cache, query } = options;
  const ageMs =
    cache.lastReconciledAt > 0 ? Math.max(0, Date.now() - cache.lastReconciledAt) : 0;
  response.headers.set('Cache-Control', 'no-store, no-cache, max-age=0, must-revalidate');
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
