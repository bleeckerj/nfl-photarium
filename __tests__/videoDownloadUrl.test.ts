import { afterEach, describe, expect, it } from 'vitest';
import { resolveVideoDownloadUrl, resolveVideoDownloadUrls } from '@/server/videoDownloadUrl';

const ORIGINAL_ENV = { ...process.env };

describe('resolveVideoDownloadUrl', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('derives Cloudflare download URL from HLS URL', () => {
    expect(resolveVideoDownloadUrl({
      hlsUrl: 'https://videodelivery.net/abc123/manifest/video.m3u8',
    })).toBe('https://videodelivery.net/abc123/downloads/default.mp4');
  });

  it('derives Cloudflare download URL from playback iframe URL', () => {
    expect(resolveVideoDownloadUrl({
      playbackUrl: 'https://videodelivery.net/abc123/iframe',
    })).toBe('https://videodelivery.net/abc123/downloads/default.mp4');
  });

  it('derives Cloudflare download URL from watch URL', () => {
    expect(resolveVideoDownloadUrl({
      playbackUrl: 'https://videodelivery.net/abc123/watch',
    })).toBe('https://videodelivery.net/abc123/downloads/default.mp4');
  });

  it('falls back to source/original direct video URLs', () => {
    expect(resolveVideoDownloadUrl({
      sourceUrl: 'https://cdn.example.com/path/video.mp4',
    })).toBe('https://cdn.example.com/path/video.mp4');
  });

  it('does not include non-video page URLs as fallback candidates', () => {
    expect(resolveVideoDownloadUrls({
      streamUid: 'abc12345',
      sourceUrl: 'https://www.threads.com/@example/post/abc123',
    })).toEqual([
      'https://videodelivery.net/abc12345/downloads/default.mp4',
    ]);
  });

  it('returns empty string when nothing downloadable is available', () => {
    expect(resolveVideoDownloadUrl({
      playbackUrl: 'notaurl',
      hlsUrl: 'still-not-a-url',
      sourceUrl: 'javascript:alert(1)',
    })).toBe('');
  });

  it('includes a streamUid-derived fallback download URL', () => {
    expect(resolveVideoDownloadUrls({
      streamUid: 'abc12345',
      playbackUrl: 'https://old.example.com/abc12345/iframe',
    })).toEqual([
      'https://old.example.com/abc12345/downloads/default.mp4',
      'https://videodelivery.net/abc12345/downloads/default.mp4',
    ]);
  });

  it('extracts stream uid when legacy records store streamUid as a full URL', () => {
    expect(resolveVideoDownloadUrls({
      streamUid: 'https://videodelivery.net/xyz98765/iframe',
    })).toEqual([
      'https://videodelivery.net/xyz98765/downloads/default.mp4',
    ]);
  });

  it('uses the configured customer subdomain for streamUid fallback URLs', () => {
    process.env = {
      ...ORIGINAL_ENV,
      CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN: 'customer-streams',
    };

    expect(resolveVideoDownloadUrls({
      streamUid: 'abc12345',
    })).toEqual([
      'https://customer-streams.cloudflarestream.com/abc12345/downloads/default.mp4',
    ]);
  });

  it('prefers the customer delivery host inferred from thumbnail and preview URLs', () => {
    expect(resolveVideoDownloadUrls({
      streamUid: 'abc12345',
      playbackUrl: 'https://videodelivery.net/abc12345/iframe',
      thumbnailUrl: 'https://customer-2v1fhua5q7p6kxxk.cloudflarestream.com/abc12345/thumbnails/thumbnail.jpg',
      previewUrl: 'https://customer-2v1fhua5q7p6kxxk.cloudflarestream.com/abc12345/watch',
    })).toEqual([
      'https://videodelivery.net/abc12345/downloads/default.mp4',
      'https://customer-2v1fhua5q7p6kxxk.cloudflarestream.com/abc12345/downloads/default.mp4',
    ]);
  });
});
