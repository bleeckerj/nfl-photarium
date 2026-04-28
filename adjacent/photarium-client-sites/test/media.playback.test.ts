import { describe, expect, it } from 'vitest';
import {
  formatAssetAspectRatio,
  formatAssetFileSize,
  formatAssetRuntime,
} from '../src/client/rendering/asset-metadata';
import { formatVideoDuration, resolveVideoPlayback } from '../src/client/rendering/media';
import type { ClientAsset } from '../src/client/domain/types';

const createVideoAsset = (overrides: Partial<ClientAsset> = {}): ClientAsset => ({
  id: 'video-1',
  assetType: 'video',
  filename: 'clip.mp4',
  displayName: 'Clip',
  description: '',
  visibleTags: ['found'],
  fileSizeBytes: null,
  aspectRatio: null,
  dimensions: null,
  isCanonical: true,
  hasEmbedding: false,
  clusterId: null,
  clusterLabel: null,
  previewVariant: null,
  videoPlaybackUrl: 'https://customer.example.com/video-1/iframe',
  videoHlsUrl: 'https://customer.example.com/video-1/manifest/video.m3u8',
  videoThumbnailUrl: 'https://customer.example.com/video-1/thumb.jpg',
  videoPreviewUrl: 'https://customer.example.com/video-1/watch',
  videoDownloadUrl: 'https://customer.example.com/video-1/downloads/default.mp4',
  preferredVideoPlaybackUrl: 'https://customer.example.com/video-1/manifest/video.m3u8',
  preferredVideoPlaybackKind: 'hls',
  hasDownloadableVideo: false,
  videoDurationSeconds: null,
  sortOrder: 0,
  ...overrides,
});

describe('resolveVideoPlayback', () => {
  it('prefers preferred HLS playback over broken direct download-looking URLs', () => {
    const playback = resolveVideoPlayback(createVideoAsset());
    expect(playback).toMatchObject({
      playUrl: 'https://customer.example.com/video-1/manifest/video.m3u8',
      playbackKind: 'hls',
      downloadUrl: null,
      hasPlayableSource: true,
      hasDownloadableSource: false,
    });
  });

  it('rejects iframe and watch URLs as direct playback sources', () => {
    const playback = resolveVideoPlayback(createVideoAsset({
      preferredVideoPlaybackUrl: null,
      preferredVideoPlaybackKind: null,
      videoHlsUrl: null,
      videoDownloadUrl: null,
    }));
    expect(playback.playUrl).toBeNull();
    expect(playback.playbackKind).toBeNull();
    expect(playback.hasPlayableSource).toBe(false);
  });

  it('keeps direct downloadable files when explicitly available', () => {
    const playback = resolveVideoPlayback(createVideoAsset({
      preferredVideoPlaybackUrl: 'https://cdn.example.com/path/video.mp4',
      preferredVideoPlaybackKind: 'file',
      videoDownloadUrl: 'https://cdn.example.com/path/video.mp4',
      hasDownloadableVideo: true,
      videoDurationSeconds: 12.2,
    }));
    expect(playback).toMatchObject({
      playUrl: 'https://cdn.example.com/path/video.mp4',
      playbackKind: 'file',
      downloadUrl: 'https://cdn.example.com/path/video.mp4',
      durationSeconds: 12.2,
      hasDownloadableSource: true,
    });
  });
});

describe('formatVideoDuration', () => {
  it('hides unknown durations', () => {
    expect(formatVideoDuration(null)).toBeNull();
  });

  it('formats whole minutes and seconds', () => {
    expect(formatVideoDuration(61)).toBe('1:01');
  });
});

describe('asset metadata formatting', () => {
  it('omits placeholder text when metadata is unavailable', () => {
    const asset = createVideoAsset();
    expect(formatAssetRuntime(asset)).toBeNull();
    expect(formatAssetAspectRatio(asset)).toBe('');
    expect(formatAssetFileSize(asset.fileSizeBytes)).toBe('');
  });
});
