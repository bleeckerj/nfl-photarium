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

describe('targeted image variant lookup', () => {
  it('requests only the affected family and follows the continuation token', async () => {
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'account');
    vi.stubEnv('CLOUDFLARE_API_TOKEN', 'token');
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ success: true, result: { images: [{ id: 'one' }], continuation_token: 'next+page' } }))
      .mockResolvedValueOnce(Response.json({ success: true, result: { images: [{ id: 'two' }] } }));
    const { fetchCloudflareImageChildren } = await import('@/server/cloudflareImageListFetcher');
    await expect(fetchCloudflareImageChildren('parent/id')).resolves.toEqual([{ id: 'one' }, { id: 'two' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = new URL(String(fetchMock.mock.calls[0][0]));
    const second = new URL(String(fetchMock.mock.calls[1][0]));
    expect(first.pathname).toBe('/client/v4/accounts/account/images/v2');
    expect(first.searchParams.get('meta.variationParentId[eq:string]')).toBe('parent/id');
    expect(second.searchParams.get('continuation_token')).toBe('next+page');
  });

  it('rejects a partial family when Cloudflare rate limits the next page', async () => {
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'account');
    vi.stubEnv('CLOUDFLARE_API_TOKEN', 'token');
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ success: true, result: { images: [{ id: 'one' }], continuation_token: 'next' } }))
      .mockResolvedValueOnce(new Response('Too Many Requests', { status: 429 }));
    const { fetchCloudflareImageChildren } = await import('@/server/cloudflareImageListFetcher');
    await expect(fetchCloudflareImageChildren('parent')).rejects.toThrow('HTTP 429');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
