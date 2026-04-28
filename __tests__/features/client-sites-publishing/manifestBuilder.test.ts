import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CachedCloudflareImage } from '@/server/cloudflareImageCache';
import type { VideoAssetRecord } from '@/server/videoCatalogStorage';

const getCachedImagesMock = vi.fn();
const listVideoAssetRecordsWithSyncMock = vi.fn();
const enrichAssetsForPublishingMock = vi.fn();

vi.mock('@/server/cloudflareImageCache', () => ({
  getCachedImages: getCachedImagesMock,
}));

vi.mock('@/server/videoCatalogStorage', () => ({
  listVideoAssetRecordsWithSync: listVideoAssetRecordsWithSyncMock,
}));

vi.mock('@/server/videoDownloadUrl', () => ({
  resolveVideoDownloadUrl: () => 'https://cdn.example.com/video.mp4',
}));

vi.mock('@/server/assetMetadataEnrichment', () => ({
  enrichAssetsForPublishing: enrichAssetsForPublishingMock,
  getMissingPublishMetadataReasons: (asset: CachedCloudflareImage | VideoAssetRecord) => {
    const reasons: string[] = [];
    if ('assetType' in asset && asset.assetType === 'video') {
      if (!asset.fileSizeBytes) reasons.push('size');
      if (!asset.durationSeconds) reasons.push('runtime');
      if (!(asset.aspectRatio || (asset.width && asset.height))) reasons.push('ratio');
      return reasons;
    }
    const image = asset as CachedCloudflareImage;
    if (!image.size) reasons.push('size');
    if (!(image.aspectRatio || (image.dimensions?.width && image.dimensions?.height))) reasons.push('ratio');
    return reasons;
  },
}));

describe('buildPublishedProjectManifest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('publishes enriched image metadata into the manifest', async () => {
    const baseImage: CachedCloudflareImage = {
      id: 'img-1',
      filename: 'img.jpg',
      uploaded: '2026-04-27T00:00:00.000Z',
      variants: [],
      tags: ['alpha'],
    };
    getCachedImagesMock.mockResolvedValue([baseImage]);
    listVideoAssetRecordsWithSyncMock.mockResolvedValue([]);
    enrichAssetsForPublishingMock.mockResolvedValue({
      images: new Map([
        [
          'img-1',
          {
            ...baseImage,
            size: 2048,
            aspectRatio: '3:2',
            dimensions: { width: 1800, height: 1200 },
          },
        ],
      ]),
      videos: new Map(),
    });

    const { buildPublishedProjectManifest } = await import('@/features/client-sites-publishing/manifestBuilder');
    const manifest = await buildPublishedProjectManifest({
      project: {
        id: 'project-1',
        publicSlug: 'abcdefghijkl',
        title: 'Project',
      },
      selection: {
        assetIds: ['img-1'],
      },
    });

    expect(manifest.assets[0]).toMatchObject({
      sourceAssetId: 'img-1',
      fileSizeBytes: 2048,
      aspectRatio: '3:2',
      dimensions: { width: 1800, height: 1200 },
    });
  });

  it('fails publishing when metadata is still incomplete after enrichment', async () => {
    const baseImage: CachedCloudflareImage = {
      id: 'img-2',
      filename: 'img-2.jpg',
      uploaded: '2026-04-27T00:00:00.000Z',
      variants: [],
      tags: [],
    };
    getCachedImagesMock.mockResolvedValue([baseImage]);
    listVideoAssetRecordsWithSyncMock.mockResolvedValue([]);
    enrichAssetsForPublishingMock.mockResolvedValue({
      images: new Map([['img-2', baseImage]]),
      videos: new Map(),
    });

    const { buildPublishedProjectManifest } = await import('@/features/client-sites-publishing/manifestBuilder');

    await expect(
      buildPublishedProjectManifest({
        project: {
          id: 'project-1',
          publicSlug: 'abcdefghijkl',
          title: 'Project',
        },
        selection: {
          assetIds: ['img-2'],
        },
      })
    ).rejects.toThrow(/Unable to publish assets with incomplete metadata/);
  });
});
