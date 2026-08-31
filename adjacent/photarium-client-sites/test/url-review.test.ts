import { describe, expect, it } from 'vitest';
import { parseUrlReviewManifest } from '../src/client/url-review/types';

describe('URL review manifests', () => {
  it('normalizes supported manifest shapes and removes duplicates', () => {
    expect(parseUrlReviewManifest({
      query: 'Steven Ahlgren',
      source: 'Google Images',
      imageUrls: [
        ' https://example.com/one.jpg ',
        'https://example.com/one.jpg',
        'http://example.com/two.jpg',
        'mailto:invalid@example.com',
        42,
      ],
    })).toEqual({
      query: 'Steven Ahlgren',
      source: 'Google Images',
      imageUrls: ['https://example.com/one.jpg', 'http://example.com/two.jpg'],
    });
  });

  it('accepts a bare JSON URL array', () => {
    expect(parseUrlReviewManifest(['https://example.com/image.jpg'])).toMatchObject({
      imageUrls: ['https://example.com/image.jpg'],
    });
  });

  it('rejects manifests without valid image URLs', () => {
    expect(() => parseUrlReviewManifest({ imageUrls: ['relative/path.jpg'] })).toThrow(
      'No valid http(s) image URLs were found.'
    );
  });
});
