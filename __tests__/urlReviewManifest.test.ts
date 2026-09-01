import { describe, expect, it } from 'vitest';
import { buildUrlReviewManifest, type UrlReviewCandidate } from '@/features/url-review/types';

describe('buildUrlReviewManifest', () => {
  it('exports only kept image candidates and excludes videos', () => {
    const candidates: UrlReviewCandidate[] = [
      { id: 'image-1', kind: 'image', url: 'https://example.com/one.jpg', filename: 'one.jpg' },
      { id: 'video-1', kind: 'video', url: 'https://example.com/clip.mp4', filename: 'clip.mp4' },
      { id: 'image-2', kind: 'image', url: 'https://example.com/two.jpg', filename: 'two.jpg' },
    ];

    expect(buildUrlReviewManifest(
      'https://archive.org/details/vintageai',
      candidates,
      new Set(['https://example.com/one.jpg', 'https://example.com/clip.mp4'])
    )).toEqual({
      query: 'https://archive.org/details/vintageai',
      source: 'https://archive.org/details/vintageai',
      imageUrls: ['https://example.com/one.jpg'],
    });
  });
});
