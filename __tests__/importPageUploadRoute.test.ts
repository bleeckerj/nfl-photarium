import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/import/page/upload/route';

const ORIGINAL_ENV = { ...process.env };

const {
  uploadImageBufferMock,
  validateParentForNewChildMock,
} = vi.hoisted(() => ({
  uploadImageBufferMock: vi.fn(),
  validateParentForNewChildMock: vi.fn(),
}));

vi.mock('@/server/uploadService', async () => {
  const actual = await vi.importActual<typeof import('@/server/uploadService')>('@/server/uploadService');
  return {
    ...actual,
    uploadImageBuffer: uploadImageBufferMock,
  };
});

vi.mock('@/server/parentValidation', () => ({
  validateParentForNewChild: validateParentForNewChildMock,
}));

const createRequest = (body: Record<string, unknown>) =>
  new NextRequest(
    new Request('http://localhost/api/import/page/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );

describe('POST /api/import/page/upload', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct';
    process.env.CLOUDFLARE_API_TOKEN = 'token';
    validateParentForNewChildMock.mockResolvedValue({ ok: true, canonicalParentId: undefined });
    uploadImageBufferMock.mockResolvedValue({
      ok: true,
      data: {
        id: 'img-1',
        filename: 'folder_applications.png',
        uploaded: '2026-03-07T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/img-1/public'],
      },
    });
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('rejects remote images smaller than 4KB by default', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array(2048), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      })
    );

    const response = await POST(createRequest({
      items: [
        {
          clientId: 'c1',
          url: 'https://example.com/folder_applications.png',
          namespace: 'test-ns',
        },
      ],
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.results).toEqual([]);
    expect(payload.failures).toEqual([
      expect.objectContaining({
        clientId: 'c1',
        error: 'Image smaller than 4KB',
      }),
    ]);
    expect(uploadImageBufferMock).not.toHaveBeenCalled();
  });

  it('accepts remote images between 1KB and 4KB when small assets are enabled', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array(2048), {
        status: 200,
        headers: {
          'content-type': 'image/png',
          'content-disposition': 'inline; filename=\"folder_applications.png\"',
        },
      })
    );

    const response = await POST(createRequest({
      includeSmallAssets: true,
      items: [
        {
          clientId: 'c1',
          url: 'https://example.com/folder_applications.png',
          namespace: 'test-ns',
        },
      ],
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.failures).toEqual([]);
    expect(payload.results).toEqual([
      expect.objectContaining({
        clientId: 'c1',
        id: 'img-1',
      }),
    ]);
    expect(uploadImageBufferMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fileSize: 2048,
      })
    );
  });
});
