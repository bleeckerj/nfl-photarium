import { describe, expect, it } from 'vitest';
import {
  buildVideoDownloadShareUrl,
  buildShareUrl,
  buildVideoDetailShareUrl,
  deriveInitialShareBaseUrl,
  normalizeShareBaseUrl,
} from '@/services/shareLinkService';

describe('shareLinkService URL normalization', () => {
  it('adds http:// when share base is a bare host:port', () => {
    expect(normalizeShareBaseUrl('192.168.1.42:3000')).toBe('http://192.168.1.42:3000');
  });

  it('removes www prefix for IPv4 hosts', () => {
    expect(normalizeShareBaseUrl('http://www.192.168.1.42:3000')).toBe('http://192.168.1.42:3000');
  });

  it('builds image share URLs from normalized base', () => {
    expect(buildShareUrl({
      imageId: 'img-1',
      shareBaseUrl: '192.168.1.42:3000',
      shareVariant: 'medium',
    })).toBe('http://192.168.1.42:3000/api/images/img-1/share?variant=medium');
  });

  it('builds video detail URLs from normalized base', () => {
    expect(buildVideoDetailShareUrl({
      videoId: 'vid-1',
      shareBaseUrl: 'https://www.192.168.1.42:3000',
    })).toBe('https://192.168.1.42:3000/videos/vid-1');
  });

  it('builds video download URLs from normalized base', () => {
    expect(buildVideoDownloadShareUrl({
      videoId: 'vid-1',
      shareBaseUrl: '192.168.1.42:3000',
    })).toBe('http://192.168.1.42:3000/api/videos/vid-1/download');
  });

  it('returns empty string for invalid base URL', () => {
    expect(buildVideoDetailShareUrl({
      videoId: 'vid-1',
      shareBaseUrl: 'not a url with spaces',
    })).toBe('');
  });

  it('prefers current LAN origin over stale stored LAN IP', () => {
    expect(deriveInitialShareBaseUrl({
      currentOrigin: 'http://192.168.15.60:3000',
      storedShareBaseUrl: 'http://192.168.15.63:3000',
    })).toBe('http://192.168.15.60:3000');
  });

  it('keeps stored LAN IP when current origin is localhost', () => {
    expect(deriveInitialShareBaseUrl({
      currentOrigin: 'http://localhost:3000',
      storedShareBaseUrl: 'http://192.168.15.60:3000',
    })).toBe('http://192.168.15.60:3000');
  });
});
