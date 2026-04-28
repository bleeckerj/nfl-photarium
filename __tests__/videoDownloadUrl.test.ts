import { afterEach, describe, expect, it } from 'vitest';
import { resolveVideoDownloadUrl, resolveVideoDownloadUrls } from '@/server/videoDownloadUrl';

const ORIGINAL_ENV = { ...process.env };

describe('resolveVideoDownloadUrl', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('does not infer downloadable files from HLS manifests', () => {
    expect(resolveVideoDownloadUrl({
      hlsUrl: 'https://videodelivery.net/abc123/manifest/video.m3u8',
    })).toBe('');
  });

  it('does not infer downloadable files from iframe URLs', () => {
    expect(resolveVideoDownloadUrl({
      playbackUrl: 'https://videodelivery.net/abc123/iframe',
    })).toBe('');
  });

  it('does not infer downloadable files from watch URLs', () => {
    expect(resolveVideoDownloadUrl({
      playbackUrl: 'https://videodelivery.net/abc123/watch',
    })).toBe('');
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
    })).toEqual([]);
  });

  it('returns empty string when nothing downloadable is available', () => {
    expect(resolveVideoDownloadUrl({
      playbackUrl: 'notaurl',
      hlsUrl: 'still-not-a-url',
      sourceUrl: 'javascript:alert(1)',
    })).toBe('');
  });

  it('does not synthesize streamUid-derived download URLs', () => {
    expect(resolveVideoDownloadUrls({
      streamUid: 'abc12345',
      playbackUrl: 'https://old.example.com/abc12345/iframe',
    })).toEqual([]);
  });

  it('does not synthesize download URLs from legacy streamUid URL strings', () => {
    expect(resolveVideoDownloadUrls({
      streamUid: 'https://videodelivery.net/xyz98765/iframe',
    })).toEqual([]);
  });

  it('ignores customer subdomain config when no direct downloadable URL exists', () => {
    process.env = {
      ...ORIGINAL_ENV,
      CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN: 'customer-streams',
    };

    expect(resolveVideoDownloadUrls({
      streamUid: 'abc12345',
    })).toEqual([]);
  });

  it('does not infer download URLs from thumbnail and preview hosts', () => {
    expect(resolveVideoDownloadUrls({
      streamUid: 'abc12345',
      playbackUrl: 'https://videodelivery.net/abc12345/iframe',
      thumbnailUrl: 'https://customer-2v1fhua5q7p6kxxk.cloudflarestream.com/abc12345/thumbnails/thumbnail.jpg',
      previewUrl: 'https://customer-2v1fhua5q7p6kxxk.cloudflarestream.com/abc12345/watch',
    })).toEqual([]);
  });
});
