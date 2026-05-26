import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildDetailImageUrl,
  fetchDetailImageResponse,
} from '@/services/detailImageService';

describe('detailImageService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds detail image URLs with vector metadata included', () => {
    expect(buildDetailImageUrl('img 1/2')).toBe('/api/images/img%201%2F2?includeVectorMeta=1');
  });

  it('fetches detail images through the vector-enriched endpoint', async () => {
    const response = new Response(JSON.stringify({ image: { id: 'img-1' } }), { status: 200 });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);

    await expect(fetchDetailImageResponse('img-1')).resolves.toBe(response);
    expect(fetchMock).toHaveBeenCalledWith('/api/images/img-1?includeVectorMeta=1');
  });
});
