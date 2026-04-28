import { describe, expect, it } from 'vitest';
import { AssetDeliveryService } from '../src/worker/delivery/service';

const policy = {
  viewPresets: [{ name: 'grid', label: 'Grid', sourceVariant: 'public' }],
  downloadPresets: [{ name: 'web', label: 'Web', width: 1600 }],
  allowedOutputFormats: ['jpg', 'webp'] as const,
};

describe('AssetDeliveryService', () => {
  const service = new AssetDeliveryService('account-hash');

  it('builds image view URLs through Cloudflare Images delivery', () => {
    expect(service.buildViewUrl({
      assetType: 'image',
      publicAssetId: 'public-1',
      projectId: 'project-1',
      revisionId: 'rev-1',
      sourceAssetId: 'img-1',
      filename: 'photo.jpg',
      visibleTags: [],
      sourceTags: [],
      uploadedAt: '2026-04-26T00:00:00.000Z',
      isCanonical: true,
      hasEmbedding: false,
      sortOrder: 0,
      createdAt: '2026-04-26T00:00:00.000Z',
      updatedAt: '2026-04-26T00:00:00.000Z',
    }, policy, 'grid')).toBe('https://imagedelivery.net/account-hash/img-1/public');
  });

  it('builds video view URLs from thumbnail metadata', () => {
    expect(service.buildViewUrl({
      assetType: 'video',
      publicAssetId: 'public-2',
      projectId: 'project-1',
      revisionId: 'rev-1',
      sourceAssetId: 'vid-1',
      filename: 'clip.mp4',
      visibleTags: [],
      sourceTags: [],
      uploadedAt: '2026-04-26T00:00:00.000Z',
      isCanonical: true,
      hasEmbedding: false,
      videoThumbnailUrl: 'https://videodelivery.net/vid-1/thumbnails/thumbnail.jpg',
      videoPlaybackUrl: 'https://videodelivery.net/vid-1/iframe',
      videoHlsUrl: 'https://videodelivery.net/vid-1/manifest/video.m3u8',
      sortOrder: 0,
      createdAt: '2026-04-26T00:00:00.000Z',
      updatedAt: '2026-04-26T00:00:00.000Z',
    }, policy, 'grid')).toBe('https://videodelivery.net/vid-1/thumbnails/thumbnail.jpg');
  });

  it('rejects image download preset routes for video assets', async () => {
    await expect(service.buildDownloadResponse({
      assetType: 'video',
      publicAssetId: 'public-2',
      projectId: 'project-1',
      revisionId: 'rev-1',
      sourceAssetId: 'vid-1',
      filename: 'clip.mp4',
      visibleTags: [],
      sourceTags: [],
      uploadedAt: '2026-04-26T00:00:00.000Z',
      isCanonical: true,
      hasEmbedding: false,
      videoDownloadUrl: 'https://videodelivery.net/vid-1/downloads/default.mp4',
      sortOrder: 0,
      createdAt: '2026-04-26T00:00:00.000Z',
      updatedAt: '2026-04-26T00:00:00.000Z',
    }, policy, 'web', 'jpg')).resolves.toBeNull();
  });
});
