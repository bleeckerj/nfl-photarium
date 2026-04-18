import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { fetchCloudflareImageMock, getCloudflareCredentialsMock } = vi.hoisted(() => ({
  fetchCloudflareImageMock: vi.fn(),
  getCloudflareCredentialsMock: vi.fn(),
}));

vi.mock('@/server/cloudflareClient', () => ({
  fetchCloudflareImage: fetchCloudflareImageMock,
  getCloudflareCredentials: getCloudflareCredentialsMock,
}));

import { GET } from '@/app/api/images/[id]/download/route';

describe('GET /api/images/:id/download', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    fetchCloudflareImageMock.mockReset();
    getCloudflareCredentialsMock.mockReset();
  });

  it('uses the Cloudflare blob API for variant=original', async () => {
    fetchCloudflareImageMock.mockResolvedValue({
      id: 'img',
      filename: 'orig.png',
      uploaded: '2026-02-01T00:00:00.000Z',
      variants: ['https://imagedelivery.net/hash/img/public'],
    });
    getCloudflareCredentialsMock.mockReturnValue({ accountId: 'acct', apiToken: 'token' });

    const mockFetch = vi.spyOn(globalThis, 'fetch').mockImplementation((input: any, init?: any) => {
      const url = String(input);
      if (url.includes('/images/v1/img/blob')) {
        expect(init?.headers?.Authorization).toBe('Bearer token');
        return Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } }));
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const req = new NextRequest(new Request('http://localhost/api/images/img/download?variant=original', { method: 'GET' }));
    const res = await GET(req, { params: Promise.resolve({ id: 'img' }) });

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Photarium-Variant-Requested')).toBe('original');
    expect(res.headers.get('X-Photarium-Variant-Served')).toBe('original');
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Content-Disposition')).toContain('orig.png');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('supports inline disposition for original blob rendering', async () => {
    fetchCloudflareImageMock.mockResolvedValue({
      id: 'img',
      filename: 'anim.webp',
      uploaded: '2026-02-01T00:00:00.000Z',
      variants: ['https://imagedelivery.net/hash/img/public'],
    });
    getCloudflareCredentialsMock.mockReturnValue({ accountId: 'acct', apiToken: 'token' });

    const mockFetch = vi.spyOn(globalThis, 'fetch').mockImplementation((input: any) => {
      const url = String(input);
      if (url.includes('/images/v1/img/blob')) {
        return Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/webp' } }));
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const req = new NextRequest(new Request('http://localhost/api/images/img/download?variant=original&disposition=inline', { method: 'GET' }));
    const res = await GET(req, { params: Promise.resolve({ id: 'img' }) });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toBe('inline; filename="anim.webp"');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('downloads a named delivery variant and reports which was served', async () => {
    fetchCloudflareImageMock.mockResolvedValue({
      id: 'img',
      filename: 'img.png',
      uploaded: '2026-02-01T00:00:00.000Z',
      variants: [
        'https://imagedelivery.net/hash/img/public',
        'https://imagedelivery.net/hash/img/thumb',
      ],
    });

    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([9, 9, 9]), { status: 200, headers: { 'content-type': 'image/jpeg' } })
    );

    const req = new NextRequest(new Request('http://localhost/api/images/img/download?variant=thumb', { method: 'GET' }));
    const res = await GET(req, { params: Promise.resolve({ id: 'img' }) });

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Photarium-Variant-Requested')).toBe('thumb');
    expect(res.headers.get('X-Photarium-Variant-Served')).toBe('thumb');
    expect(mockFetch).toHaveBeenCalledWith('https://imagedelivery.net/hash/img/thumb', { cache: 'no-store' });
  });
});
