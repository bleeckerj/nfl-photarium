import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getCachedImages, getCacheStats } from '@/server/cloudflareImageCache';
import { analyzeGalleryDuplicates } from '@/server/galleryDuplicateAnalysis';
import { getImageFolderOverrides, getImageFolderOverridesVersion } from '@/server/imageExtras';
import {
  applyFolderOverridesToAssets,
  matchesNamespace,
} from '@/server/galleryQueryRoute';

export async function GET(request: NextRequest) {
  const startedAt = performance.now();
  const requestId = randomUUID();
  const namespaceParam = request.nextUrl.searchParams.get('namespace');
  const folder = request.nextUrl.searchParams.get('folder')?.trim() || '';
  const pageIds = request.nextUrl.searchParams.getAll('pageId').filter(Boolean);
  const defaultNamespace =
    process.env.IMAGE_NAMESPACE || process.env.NEXT_PUBLIC_IMAGE_NAMESPACE || '';
  const namespace =
    namespaceParam === '__none__'
      ? ''
      : namespaceParam === '__all__'
        ? null
        : namespaceParam !== null
          ? namespaceParam.trim()
          : defaultNamespace;

  try {
    const [images, folderOverrides] = await Promise.all([
      getCachedImages(false),
      getImageFolderOverrides(),
    ]);
    const cache = getCacheStats();
    const catalogVersion = cache.contentVersion ?? cache.lastFetched ?? 0;
    const scoped = applyFolderOverridesToAssets(
      images.filter((image) => matchesNamespace(image.namespace, namespace)),
      folderOverrides
    ).filter((image) => {
      if (!folder || folder === 'all') return true;
      if (folder === 'no-folder') return !image.folder;
      return image.folder === folder;
    });
    const analysisStartedAt = performance.now();
    const analysis = await analyzeGalleryDuplicates(scoped, {
      catalogVersion,
      scopeKey: [
        namespace ?? '__all__',
        folder || 'all',
        getImageFolderOverridesVersion(),
      ].join('|'),
      pageIds,
    });
    const timings = {
      duplicate_analysis: Number((performance.now() - analysisStartedAt).toFixed(1)),
      total: Number((performance.now() - startedAt).toFixed(1)),
    };
    const response = NextResponse.json({
      ...analysis,
      requestId,
      scope: {
        namespace: namespace ?? '__all__',
        folder: folder || 'all',
      },
      timings,
    });
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('X-Photarium-Request-ID', requestId);
    response.headers.set('X-Photarium-Catalog-Version', String(catalogVersion));
    response.headers.set(
      'Server-Timing',
      Object.entries(timings)
        .map(([name, duration]) => `${name};dur=${duration}`)
        .join(', ')
    );
    return response;
  } catch (error) {
    console.error('[DuplicateAnalysis] Failed', { requestId, error });
    return NextResponse.json(
      {
        status: 'error',
        requestId,
        error: error instanceof Error ? error.message : 'Duplicate analysis failed',
      },
      { status: 500 }
    );
  }
}
