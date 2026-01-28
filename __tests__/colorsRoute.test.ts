import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/server/vectorSearch', () => {
  return {
    isVectorSearchAvailable: vi.fn(async () => true),
    batchGetColorMetadata: vi.fn(async (ids: string[]) => {
      // Return metadata for only the first id to simulate missing entries.
      const map = new Map();
      map.set(ids[0], {
        dominantColors: ['#ffffff'],
        averageColor: '#000000',
        hasClipEmbedding: true,
        hasColorEmbedding: true,
      });
      return map;
    }),
  };
});

import { GET } from '@/app/api/images/colors/route';

describe('GET /api/images/colors', () => {
  it('returns entries for all requested ids (defaults for missing)', async () => {
    const req = new NextRequest(
      new Request('http://localhost/api/images/colors?ids=a,b,c', { method: 'GET' })
    );

    const res = await GET(req);
    expect(res.status).toBe(200);

    const payload = await res.json();
    expect(payload).toHaveProperty('colors');
    expect(Object.keys(payload.colors)).toEqual(['a', 'b', 'c']);

    expect(payload.colors.a.hasColorEmbedding).toBe(true);
    expect(payload.colors.b.hasColorEmbedding).toBe(false);
    expect(payload.colors.c.hasClipEmbedding).toBe(false);
  });
});
