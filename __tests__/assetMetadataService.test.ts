import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestAssetMetadataUpdate } from '@/services/assetMetadataService';

describe('asset metadata updates', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(['image', 'video'] as const)('updates %s metadata through an encoded endpoint', async assetType => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"success":true}'));
    await requestAssetMetadataUpdate('asset /1', assetType, { namespace: 'target' });
    expect(fetchMock).toHaveBeenCalledWith(`/api/${assetType === 'video' ? 'videos' : 'images'}/asset%20%2F1/update`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{"namespace":"target"}',
    });
  });

  it('reports the server error for a throttled move', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"error":"Cloudflare is throttling image updates. Retry in 30 seconds."}', { status: 429 }));
    await expect(requestAssetMetadataUpdate('asset', 'image', { namespace: 'target' })).rejects.toThrow('Retry in 30 seconds');
  });

  it('handles non-JSON failures without exposing response markup', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>Unavailable</html>', { status: 502 }));
    await expect(requestAssetMetadataUpdate('asset', 'image', {})).rejects.toThrow('Metadata update failed (HTTP 502)');
  });

  it.each(['{"success":false,"error":"Move rejected"}', '{}', 'invalid'])('rejects unconfirmed successful HTTP responses: %s', async body => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body));
    await expect(requestAssetMetadataUpdate('asset', 'image', {})).rejects.toThrow();
  });
});
