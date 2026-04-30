import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH } from '@/app/api/images/[id]/favorite/route';
import { FAVORITE_TAG } from '@/utils/systemTags';

const { transformApiImageToCachedMock, upsertCachedImageMock } = vi.hoisted(() => ({
  transformApiImageToCachedMock: vi.fn((image) => ({
    id: image.id,
    filename: image.filename || 'image.png',
    uploaded: image.uploaded,
    variants: image.variants,
    tags: image.meta?.tags ?? [],
  })),
  upsertCachedImageMock: vi.fn(),
}));

vi.mock('@/server/cloudflareImageCache', () => ({
  transformApiImageToCached: transformApiImageToCachedMock,
  upsertCachedImage: upsertCachedImageMock,
}));

const ORIGINAL_ENV = { ...process.env };

const createRequest = (body: Record<string, unknown>) => new NextRequest(
  new Request('http://localhost/api/images/image-1/favorite', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
);

describe('PATCH /api/images/:id/favorite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    transformApiImageToCachedMock.mockClear();
    upsertCachedImageMock.mockClear();
    process.env = { ...ORIGINAL_ENV };
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct';
    process.env.CLOUDFLARE_API_TOKEN = 'token';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('adds favorite while preserving ordinary tags', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch');
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({
        result: {
          id: 'image-1',
          filename: 'image.png',
          uploaded: '2026-01-01T00:00:00.000Z',
          variants: ['https://example.com/public'],
          meta: JSON.stringify({ tags: ['hero'] }),
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: {} }), { status: 200 }));

    const response = await PATCH(createRequest({ favorite: true }), { params: Promise.resolve({ id: 'image-1' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.favorite).toBe(true);
    expect(payload.tags).toEqual(['hero', FAVORITE_TAG]);

    const parsedPatch = JSON.parse(String(mockFetch.mock.calls[1]?.[1]?.body));
    expect(parsedPatch.metadata.tags).toEqual(['hero', FAVORITE_TAG]);
    expect(upsertCachedImageMock).toHaveBeenCalledTimes(1);
  });

  it('removes only the favorite tag', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch');
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({
        result: {
          id: 'image-1',
          filename: 'image.png',
          uploaded: '2026-01-01T00:00:00.000Z',
          variants: ['https://example.com/public'],
          meta: JSON.stringify({ tags: ['hero', FAVORITE_TAG, 'portrait'] }),
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: {} }), { status: 200 }));

    const response = await PATCH(createRequest({ favorite: false }), { params: Promise.resolve({ id: 'image-1' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.favorite).toBe(false);
    expect(payload.tags).toEqual(['hero', 'portrait']);

    const parsedPatch = JSON.parse(String(mockFetch.mock.calls[1]?.[1]?.body));
    expect(parsedPatch.metadata.tags).toEqual(['hero', 'portrait']);
  });
});
