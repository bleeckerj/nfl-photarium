import { describe, expect, it } from 'vitest';
import { mapAssetToPublicPayload } from '../src/worker/assets/mapper';

describe('mapAssetToPublicPayload', () => {
  it('sanitizes iframe/watch video URLs from public payloads', () => {
    const payload = mapAssetToPublicPayload({
      assetType: 'video',
      publicAssetId: 'public-1',
      projectId: 'project-1',
      revisionId: 'revision-1',
      sourceAssetId: 'video-1',
      filename: 'clip.mp4',
      visibleTags: [],
      sourceTags: [],
      uploadedAt: '2026-04-27T00:00:00.000Z',
      isCanonical: true,
      hasEmbedding: false,
      videoPlaybackUrl: 'https://customer.example.com/video-1/iframe',
      videoHlsUrl: 'https://customer.example.com/video-1/manifest/video.m3u8',
      videoThumbnailUrl: 'https://customer.example.com/video-1/thumbnails/thumbnail.jpg',
      videoPreviewUrl: 'https://customer.example.com/video-1/watch',
      sortOrder: 0,
      createdAt: '2026-04-27T00:00:00.000Z',
      updatedAt: '2026-04-27T00:00:00.000Z',
    });

    expect(payload.videoPlaybackUrl).toBeNull();
    expect(payload.videoPreviewUrl).toBeNull();
    expect(payload.videoDownloadUrl).toBeNull();
    expect(payload.preferredVideoPlaybackUrl).toBe(
      'https://customer.example.com/video-1/manifest/video.m3u8'
    );
    expect(payload.preferredVideoPlaybackKind).toBe('hls');
    expect(payload.hasDownloadableVideo).toBe(false);
  });
});
