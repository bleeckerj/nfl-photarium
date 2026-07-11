import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { getCachedImagesMock, getImageExtrasRecordsMock } = vi.hoisted(() => ({
  getCachedImagesMock: vi.fn(),
  getImageExtrasRecordsMock: vi.fn(),
}));

vi.mock('@/server/cloudflareImageCache', () => ({ getCachedImages: getCachedImagesMock }));
vi.mock('@/server/imageExtras', () => ({ getImageExtrasRecords: getImageExtrasRecordsMock }));

import { POST } from '@/app/api/images/metadata-search/route';

const request = (body: unknown) => new NextRequest(new Request('http://localhost/api/images/metadata-search', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
}));

describe('POST /api/images/metadata-search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCachedImagesMock.mockResolvedValue([
      { id: 'source', filename: 'source.jpg', uploaded: '2026-07-11', variants: [], tags: ['portrait'], namespace: 'cf-grainrad' },
      { id: 'other', filename: 'other.jpg', uploaded: '2026-07-10', variants: [], tags: ['other'], namespace: 'elsewhere' },
    ]);
    getImageExtrasRecordsMock.mockResolvedValue({
      source: { imageId: 'source', schemaVersion: 1, createdAt: '', updatedAt: '', description: 'Foucault', altText: 'Bald man with glasses' },
      other: { imageId: 'other', schemaVersion: 1, createdAt: '', updatedAt: '', description: 'Foucault elsewhere' },
    });
  });

  it('finds an extras-only description inside the requested namespace', async () => {
    const response = await POST(request({ query: 'foucault', fields: ['description'], namespace: 'cf-grainrad' }));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.count).toBe(1);
    expect(payload.results[0]).toMatchObject({ id: 'source', description: 'Foucault', matchedFields: ['description'] });
    expect(getImageExtrasRecordsMock).toHaveBeenCalledWith(['source']);
  });

  it('supports case-sensitive exact, prefix, and regex matching', async () => {
    for (const [match, query] of [['exact', 'Foucault'], ['prefix', 'Fouc'], ['regex', '^Fou.*lt$']] as const) {
      const response = await POST(request({ query, fields: ['description'], match, caseSensitive: true, namespace: 'cf-grainrad' }));
      expect((await response.json()).count).toBe(1);
    }
    const miss = await POST(request({ query: 'foucault', fields: ['description'], match: 'exact', caseSensitive: true, namespace: 'cf-grainrad' }));
    expect((await miss.json()).count).toBe(0);
  });

  it('finds extras alt text and validates invalid regex patterns', async () => {
    const alt = await POST(request({ query: 'glasses', fields: ['altText'], namespace: 'cf-grainrad' }));
    expect((await alt.json()).results[0].matchedFields).toEqual(['altText']);
    const invalid = await POST(request({ query: '[', match: 'regex' }));
    expect(invalid.status).toBe(400);
  });
});
