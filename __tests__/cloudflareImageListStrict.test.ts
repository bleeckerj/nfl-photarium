import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.resetModules(); });

describe('strict image catalog reads', () => {
  it('retries an incomplete JSON response without accepting an incomplete catalog', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: { images: [{ id: 'image' }] } }), { status: 200 }));
    const { fetchCloudflareImagePage } = await import('@/server/cloudflareImageListFetcher');
    await expect(fetchCloudflareImagePage('account', 'token', 3, true)).resolves.toEqual([{ id: 'image' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports the page and status when both responses contain invalid JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 502 }));
    const { fetchCloudflareImagePage } = await import('@/server/cloudflareImageListFetcher');
    await expect(fetchCloudflareImagePage('account', 'token', 4, true)).rejects.toThrow('page 4 (HTTP 502)');
  });

  it('rejects malformed list responses', async () => {
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'account');
    vi.stubEnv('CLOUDFLARE_API_TOKEN', 'token');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ result: {} }), { status: 200 }));
    const { fetchAllCloudflareImagePages } = await import('@/server/cloudflareImageListFetcher');
    await expect(fetchAllCloudflareImagePages(true)).rejects.toThrow('invalid image catalog page');
  });

  it('rejects a catalog truncated by the configured page limit', async () => {
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'account');
    vi.stubEnv('CLOUDFLARE_API_TOKEN', 'token');
    vi.stubEnv('CLOUDFLARE_CACHE_MAX_PAGES', '1');
    vi.stubEnv('CLOUDFLARE_CACHE_PAGE_SIZE', '10');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ result: { images: Array(10).fill({ id: 'image' }) } }), { status: 200 }));
    const { fetchAllCloudflareImagePages } = await import('@/server/cloudflareImageListFetcher');
    await expect(fetchAllCloudflareImagePages(true)).rejects.toThrow('CLOUDFLARE_CACHE_MAX_PAGES');
  });
});
