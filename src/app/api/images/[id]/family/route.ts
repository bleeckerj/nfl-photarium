import { NextRequest, NextResponse } from 'next/server';
import { getCachedImages } from '@/server/cloudflareImageCache';
import { getImageExtrasRecords } from '@/server/imageExtras';
import { listVideoAssetRecordsWithSync } from '@/server/videoCatalogStorage';
import { getFamilyCandidatePool } from '@/server/familyCandidatePool';

type FamilyAsset = {
  id: string;
  assetType?: 'image' | 'video';
  filename: string;
  displayName?: string;
  uploaded: string;
  variants: string[];
  size?: number;
  folder?: string;
  tags?: string[];
  description?: string;
  aspectRatio?: string;
  dimensions?: { width: number; height: number };
  altTag?: string;
  altText?: string;
  parentId?: string;
  variationSort?: number;
  linkedAssetId?: string;
  originalUrl?: string;
  originalUrlNormalized?: string;
  sourceUrl?: string;
  sourceUrlNormalized?: string;
  promptThis?: string;
  namespace?: string;
  generatedBy?: string;
  comfyMetadataDetected?: boolean;
  comfyMetadataSource?: string;
  videoStatus?: 'pending' | 'ready' | 'error';
  videoDurationSeconds?: number;
  videoPlaybackUrl?: string;
  videoHlsUrl?: string;
  videoThumbnailUrl?: string;
  videoPreviewUrl?: string;
  videoAnimatedWebpUrl?: string;
};

const mark = (value: number) => Number(value.toFixed(1));

const toFamilyAsset = (image: Record<string, unknown>): FamilyAsset => {
  const rawDimensions = image.dimensions as { width?: unknown; height?: unknown } | undefined;
  const width = typeof rawDimensions?.width === 'number' ? rawDimensions.width : undefined;
  const height = typeof rawDimensions?.height === 'number' ? rawDimensions.height : undefined;

  return {
    id: String(image.id ?? ''),
    assetType: image.assetType === 'video' ? 'video' : 'image',
    filename: typeof image.filename === 'string' ? image.filename : '',
    displayName: typeof image.displayName === 'string' ? image.displayName : undefined,
    uploaded: typeof image.uploaded === 'string' ? image.uploaded : '',
    variants: Array.isArray(image.variants) ? (image.variants as string[]) : [],
    size: typeof image.size === 'number' ? image.size : undefined,
    folder: typeof image.folder === 'string' ? image.folder : undefined,
    tags: Array.isArray(image.tags) ? (image.tags as string[]) : undefined,
    description: typeof image.description === 'string' ? image.description : undefined,
    aspectRatio: typeof image.aspectRatio === 'string' ? image.aspectRatio : undefined,
    dimensions: width && height ? { width, height } : undefined,
    altTag: typeof image.altTag === 'string' ? image.altTag : undefined,
    altText: typeof image.altText === 'string' ? image.altText : undefined,
    parentId: typeof image.parentId === 'string' ? image.parentId : undefined,
    variationSort: typeof image.variationSort === 'number' ? image.variationSort : undefined,
    linkedAssetId: typeof image.linkedAssetId === 'string' ? image.linkedAssetId : undefined,
    originalUrl: typeof image.originalUrl === 'string' ? image.originalUrl : undefined,
    originalUrlNormalized: typeof image.originalUrlNormalized === 'string' ? image.originalUrlNormalized : undefined,
    sourceUrl: typeof image.sourceUrl === 'string' ? image.sourceUrl : undefined,
    sourceUrlNormalized: typeof image.sourceUrlNormalized === 'string' ? image.sourceUrlNormalized : undefined,
    promptThis: typeof image.promptThis === 'string' ? image.promptThis : undefined,
    namespace: typeof image.namespace === 'string' ? image.namespace : undefined,
    generatedBy: typeof image.generatedBy === 'string' ? image.generatedBy : undefined,
    comfyMetadataDetected: Boolean(image.comfyMetadataDetected),
    comfyMetadataSource: typeof image.comfyMetadataSource === 'string' ? image.comfyMetadataSource : undefined,
    videoStatus: image.videoStatus as 'pending' | 'ready' | 'error' | undefined,
    videoDurationSeconds: typeof image.videoDurationSeconds === 'number' ? image.videoDurationSeconds : undefined,
    videoPlaybackUrl: typeof image.videoPlaybackUrl === 'string' ? image.videoPlaybackUrl : undefined,
    videoHlsUrl: typeof image.videoHlsUrl === 'string' ? image.videoHlsUrl : undefined,
    videoThumbnailUrl: typeof image.videoThumbnailUrl === 'string' ? image.videoThumbnailUrl : undefined,
    videoPreviewUrl: typeof image.videoPreviewUrl === 'string' ? image.videoPreviewUrl : undefined,
    videoAnimatedWebpUrl: typeof image.videoAnimatedWebpUrl === 'string' ? image.videoAnimatedWebpUrl : undefined,
  };
};

const uniqueById = (assets: FamilyAsset[]) => {
  const seen = new Set<string>();
  return assets.filter((asset) => {
    if (seen.has(asset.id)) return false;
    seen.add(asset.id);
    return true;
  });
};

const applyExtrasSearchMetadata = async (assets: FamilyAsset[]) => {
  const imageIds = assets
    .filter((asset) => asset.assetType !== 'video')
    .map((asset) => asset.id)
    .filter(Boolean);
  if (imageIds.length === 0) return assets;

  const extrasById = await getImageExtrasRecords(imageIds);
  return assets.map((asset) => {
    if (asset.assetType === 'video') return asset;
    const extras = extrasById[asset.id];
    if (!extras) return asset;
    return {
      ...asset,
      ...(Object.prototype.hasOwnProperty.call(extras, 'folder')
        ? { folder: typeof extras.folder === 'string' ? extras.folder : undefined }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(extras, 'description')
        ? { description: typeof extras.description === 'string' ? extras.description : undefined }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(extras, 'altText')
        ? { altText: typeof extras.altText === 'string' ? extras.altText : undefined }
        : {}),
    };
  });
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startedAt = performance.now();
  const timings: Record<string, number> = {};
  const diagnostics: Record<string, number | boolean | string | null> = {};

  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Image ID is required' }, { status: 400 });
    }

    const includeCandidates = request.nextUrl.searchParams.get('includeCandidates') === '1';
    const cacheStartedAt = performance.now();
    const images = await getCachedImages();
    timings.cache_load = mark(performance.now() - cacheStartedAt);

    const videosStartedAt = performance.now();
    const videoAssetsEnabled = process.env.ENABLE_VIDEO_ASSETS === '1';
    const mappedVideos = videoAssetsEnabled
      ? (await listVideoAssetRecordsWithSync()).map((video) => ({
          id: video.id,
          assetType: 'video' as const,
          generatedBy: typeof video.generatedBy === 'string' ? video.generatedBy : undefined,
          comfyMetadataDetected: Boolean(video.comfyMetadataDetected),
          comfyMetadataSource: typeof video.comfyMetadataSource === 'string' ? video.comfyMetadataSource : undefined,
          filename: video.filename,
          displayName: video.displayName || video.filename,
          uploaded: video.uploaded,
          variants: [
            video.animatedWebpUrl,
            video.thumbnailUrl,
            video.playbackUrl,
            video.hlsUrl,
          ].filter(Boolean),
          folder: video.folder,
          tags: video.tags,
          description: video.description,
          originalUrl: video.originalUrl,
          sourceUrl: video.sourceUrl,
          namespace: video.namespace,
          parentId: video.parentId,
          variationSort: video.variationSort,
          videoStatus: video.videoStatus,
          videoDurationSeconds: video.durationSeconds,
          videoPlaybackUrl: video.playbackUrl,
          videoHlsUrl: video.hlsUrl,
          videoThumbnailUrl: video.thumbnailUrl,
          videoPreviewUrl: video.previewUrl,
          videoAnimatedWebpUrl: video.animatedWebpUrl,
          dimensions: video.width && video.height ? { width: video.width, height: video.height } : undefined,
          aspectRatio: video.aspectRatio,
        }))
      : [];
    timings.videos_load = mark(performance.now() - videosStartedAt);

    // Resolve the target and its family from the raw records, then run the
    // FamilyAsset projection and the extras merge over only those few
    // records. Mapping the full ~19k-asset catalog here (the previous shape)
    // cost seconds per request; the candidate pool below covers the
    // full-catalog case behind a version-keyed memo.
    const rawRecords: Record<string, unknown>[] = [
      ...(images as unknown as Record<string, unknown>[]),
      ...(mappedVideos as unknown as Record<string, unknown>[]),
    ];
    const rawTarget = rawRecords.find((record) => record.id === id) ?? null;
    if (!rawTarget) {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 });
    }

    const familyStartedAt = performance.now();
    const rawParentId = typeof rawTarget.parentId === 'string' && rawTarget.parentId
      ? rawTarget.parentId
      : undefined;
    const familyRootId = rawParentId || String(rawTarget.id);
    const familyAssets = await applyExtrasSearchMetadata(
      uniqueById(
        rawRecords
          .filter((record) => {
            if (record.id === rawTarget.id) return true;
            if (record.id === familyRootId) return true;
            return record.parentId === familyRootId;
          })
          .map((record) => toFamilyAsset(record))
      )
    );
    timings.family_collect = mark(performance.now() - familyStartedAt);

    const target = familyAssets.find((asset) => asset.id === id)!;
    const namespace = target.namespace ?? '';
    const parentAsset = familyAssets.find((asset) => asset.id === familyRootId) ?? null;
    const children = familyAssets.filter((asset) => asset.parentId === familyRootId);
    const siblings = target.parentId
      ? familyAssets.filter((asset) => asset.parentId === target.parentId && asset.id !== target.id)
      : [];

    const candidatesStartedAt = performance.now();
    const candidateAssets = includeCandidates
      ? await getFamilyCandidatePool({
          images: images as unknown as Record<string, unknown>[],
          mappedVideos: mappedVideos as unknown as Record<string, unknown>[],
          videoAssetsEnabled,
        })
      : [];
    if (includeCandidates) {
      timings.candidate_pool = mark(performance.now() - candidatesStartedAt);
    }

    diagnostics.family_count = familyAssets.length;
    diagnostics.children_count = children.length;
    diagnostics.siblings_count = siblings.length;
    diagnostics.candidates_count = candidateAssets.length;
    diagnostics.include_candidates = includeCandidates;

    timings.total = mark(performance.now() - startedAt);
    const response = NextResponse.json({
      currentId: target.id,
      namespace,
      familyRootId,
      parent: parentAsset,
      siblings,
      children,
      familyAssets,
      candidateAssets,
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
    console.error('Fetch family context error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
