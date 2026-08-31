import { describe, expect, it } from 'vitest';
import { parseUrlLines, parseUrlManifest } from '@/features/page-import/utils/urlManifest';

describe('parseUrlManifest', () => {
  it('reads the image URL manifest exported by the URL reviewer', () => {
    expect(parseUrlManifest({
      query: 'Steven Ahlgren',
      source: 'https://www.google.com/search?q=Steven+Ahlgren',
      imageUrls: [
        'https://cdn.example.com/a.jpg',
        ' https://cdn.example.com/a.jpg ',
        'https://cdn.example.com/b.jpg',
        'javascript:alert(1)',
      ],
    })).toEqual({
      urls: [
        'https://cdn.example.com/a.jpg',
        'https://cdn.example.com/b.jpg',
      ],
      sourceUrl: 'https://www.google.com/search?q=Steven+Ahlgren',
      query: 'Steven Ahlgren',
      invalidCount: 1,
      duplicateCount: 1,
    });
  });

  it('accepts a bare array and rejects manifests without URLs', () => {
    expect(parseUrlManifest(['http://example.com/one.png'])).toMatchObject({
      urls: ['http://example.com/one.png'],
      invalidCount: 0,
      duplicateCount: 0,
    });
    expect(() => parseUrlManifest({ source: 'https://example.com' })).toThrow(/imageUrls or urls array/);
  });

  it('parses one URL per line for multiline queue input', () => {
    expect(parseUrlLines('\nhttps://example.com/one.jpg\nhttps://example.com/two.png\nhttps://example.com/one.jpg')).toMatchObject({
      urls: ['https://example.com/one.jpg', 'https://example.com/two.png'],
      invalidCount: 0,
      duplicateCount: 1,
    });
    expect(() => parseUrlLines('not a URL')).toThrow(/No valid http\(s\) URLs/);
  });
});
