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

describe('GET /api/images/:id/download — SVG security hardening', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    fetchCloudflareImageMock.mockReset();
    getCloudflareCredentialsMock.mockReset();
  });

  it('forces attachment + nosniff for SVG even when inline disposition is requested', async () => {
    fetchCloudflareImageMock.mockResolvedValue({
      id: 'img',
      filename: 'logo.svg',
      uploaded: '2026-02-01T00:00:00.000Z',
      variants: ['https://imagedelivery.net/hash/img/public'],
    });
    getCloudflareCredentialsMock.mockReturnValue({ accountId: 'acct', apiToken: 'token' });

    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/images/v1/img/blob')) {
        return Promise.resolve(
          new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { 'content-type': 'image/svg+xml' },
          })
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const req = new NextRequest(
      new Request('http://localhost/api/images/img/download?variant=original&disposition=inline', { method: 'GET' })
    );
    const res = await GET(req, { params: Promise.resolve({ id: 'img' }) });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="logo.svg"');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('does not add nosniff / force attachment for raster originals', async () => {
    fetchCloudflareImageMock.mockResolvedValue({
      id: 'img',
      filename: 'photo.png',
      uploaded: '2026-02-01T00:00:00.000Z',
      variants: ['https://imagedelivery.net/hash/img/public'],
    });
    getCloudflareCredentialsMock.mockReturnValue({ accountId: 'acct', apiToken: 'token' });

    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/images/v1/img/blob')) {
        return Promise.resolve(
          new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { 'content-type': 'image/png' },
          })
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const req = new NextRequest(
      new Request('http://localhost/api/images/img/download?variant=original&disposition=inline', { method: 'GET' })
    );
    const res = await GET(req, { params: Promise.resolve({ id: 'img' }) });

    expect(res.headers.get('Content-Disposition')).toBe('inline; filename="photo.png"');
    expect(res.headers.get('X-Content-Type-Options')).toBeNull();
  });
});
