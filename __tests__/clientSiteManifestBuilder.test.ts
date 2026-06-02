import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPublishedProjectManifest } from '@/features/client-sites-publishing/manifestBuilder';

const {
  getCachedImagesMock,
  listVideoAssetRecordsWithSyncMock,
  resolveVideoDownloadUrlMock,
  resolveVideoDownloadUrlsMock,
} = vi.hoisted(() => ({
  getCachedImagesMock: vi.fn(),
  listVideoAssetRecordsWithSyncMock: vi.fn(),
  resolveVideoDownloadUrlMock: vi.fn(),
  resolveVideoDownloadUrlsMock: vi.fn(),
}));

vi.mock('@/server/cloudflareImageCache', () => ({
  getCachedImages: getCachedImagesMock,
}));

vi.mock('@/server/videoCatalogStorage', () => ({
  listVideoAssetRecordsWithSync: listVideoAssetRecordsWithSyncMock,
}));

vi.mock('@/server/videoDownloadUrl', () => ({
  resolveVideoDownloadUrl: resolveVideoDownloadUrlMock,
  resolveVideoDownloadUrls: resolveVideoDownloadUrlsMock,
}));

const baseRequest = {
  project: {
    id: 'project-1',
    publicSlug: 'client-and-sons',
    title: 'Client and Sons',
  },
  selection: {
    assetIds: [] as string[],
  },
};

describe('buildPublishedProjectManifest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCachedImagesMock.mockResolvedValue([
      {
        id: 'img-1',
        filename: 'photo.jpg',
        displayName: 'Still Life',
        description: 'Hero image',
        uploaded: '2026-04-26T01:00:00.000Z',
        tags: ['hero', 'launch'],
        size: 123456,
        aspectRatio: '4:3',
        dimensions: { width: 1600, height: 1200 },
        parentId: undefined,
        hasClipEmbedding: true,
        namespace: 'client-andSons',
      },
    ]);
    listVideoAssetRecordsWithSyncMock.mockResolvedValue([
      {
        id: 'vid-1',
        assetType: 'video',
        filename: 'clip.mp4',
        displayName: 'Walkthrough',
        description: 'Office tour',
        uploaded: '2026-04-26T02:00:00.000Z',
        tags: ['hero', 'motion'],
        fileSizeBytes: 987654,
        aspectRatio: '16:9',
        width: 1920,
        height: 1080,
        parentId: undefined,
        hasClipEmbedding: true,
        playbackUrl: 'https://videodelivery.net/vid-1/iframe',
        hlsUrl: 'https://videodelivery.net/vid-1/manifest/video.m3u8',
        thumbnailUrl: 'https://videodelivery.net/vid-1/thumb.jpg',
        previewUrl: 'https://videodelivery.net/vid-1/watch',
        durationSeconds: 13,
        videoStatus: 'ready',
        streamUid: 'vid-1',
        namespace: 'client-andSons',
        createdAt: '2026-04-26T02:00:00.000Z',
        updatedAt: '2026-04-26T02:00:00.000Z',
      },
    ]);
    resolveVideoDownloadUrlMock.mockReturnValue('https://videodelivery.net/vid-1/downloads/default.mp4');
    resolveVideoDownloadUrlsMock.mockReturnValue(['https://videodelivery.net/vid-1/downloads/default.mp4']);
  });

  it('builds an image-only manifest payload', async () => {
    const manifest = await buildPublishedProjectManifest({
      ...baseRequest,
      selection: { assetIds: ['img-1'] },
    });

    expect(manifest.assets).toHaveLength(1);
    expect(manifest.assets[0]).toEqual(
      expect.objectContaining({
        assetType: 'image',
        sourceAssetId: 'img-1',
        filename: 'photo.jpg',
        previewVariant: 'public',
        visibleTags: ['hero', 'launch'],
      })
    );
    expect(manifest.revision.sourceNamespaces).toEqual(['client-andSons']);
  });

  it('builds a video-only manifest payload', async () => {
    const manifest = await buildPublishedProjectManifest({
      ...baseRequest,
      selection: { assetIds: ['vid-1'] },
    });

    expect(manifest.assets).toHaveLength(1);
    expect(manifest.assets[0]).toEqual(
      expect.objectContaining({
        assetType: 'video',
        sourceAssetId: 'vid-1',
        filename: 'clip.mp4',
        videoPlaybackUrl: 'https://videodelivery.net/vid-1/iframe',
        videoHlsUrl: 'https://videodelivery.net/vid-1/manifest/video.m3u8',
        videoThumbnailUrl: 'https://videodelivery.net/vid-1/thumb.jpg',
        videoPreviewUrl: 'https://videodelivery.net/vid-1/watch',
        videoDownloadUrl: 'https://videodelivery.net/vid-1/downloads/default.mp4',
        videoDurationSeconds: 13,
      })
    );
    expect(manifest.revision.sourceNamespaces).toEqual(['client-andSons']);
  });

  it('builds a mixed manifest in the requested selection order', async () => {
    const manifest = await buildPublishedProjectManifest({
      ...baseRequest,
      selection: { assetIds: ['vid-1', 'img-1'] },
    });

    expect(manifest.assets.map((asset) => [asset.assetType, asset.sourceAssetId, asset.sortOrder])).toEqual([
      ['video', 'vid-1', 0],
      ['image', 'img-1', 1],
    ]);
    expect(new Set(manifest.assets.map((asset) => asset.projectAssetId)).size).toBe(2);
  });
});
