import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/upload/external/route';
import * as duplicateDetector from '@/server/duplicateDetector';

const TEST_URL = 'http://localhost/api/upload/external';
const ORIGINAL_ENV = { ...process.env };

function createRequest(formData: FormData) {
  const baseRequest = new Request(TEST_URL, {
    method: 'POST',
    body: formData,
  });
  return new NextRequest(baseRequest);
}

describe('POST /api/upload/external', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('returns 400 when no file is provided', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct';
    process.env.CLOUDFLARE_API_TOKEN = 'token';

    const formData = new FormData();
    const request = createRequest(formData);

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/No file/i);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('returns 500 when Cloudflare credentials are missing', async () => {
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;

    const file = new File(['test'], 'sample.png', { type: 'image/png' });
    const formData = new FormData();
    formData.append('file', file);

    const request = createRequest(formData);
    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toMatch(/Cloudflare credentials not configured/i);
  });

  it('uploads successfully and returns Cloudflare metadata', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct';
    process.env.CLOUDFLARE_API_TOKEN = 'token';

    const mockFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(new Response(
        JSON.stringify({
          result: {
            id: 'abc123',
            filename: 'photo.png',
            uploaded: '2026-02-01T00:00:00.000Z',
            variants: [
              'https://imagedelivery.net/hash/abc123/public',
              'https://imagedelivery.net/hash/abc123/thumb',
            ],
            images: [],
          },
        }),
        { status: 200 }
      ))
    );

    // Use unique content to avoid duplicate detection from cached test data
    const uniqueContent = `test-image-${Date.now()}-${Math.random()}`;
    const file = new File([uniqueContent], 'photo.png', { type: 'image/png' });
    const formData = new FormData();
    formData.append('file', file);
    formData.append('folder', 'astro-uploads');
    formData.append('tags', 'astro,cloudflare');
    formData.append('namespace', 'astro');

    const request = createRequest(formData);
    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.id).toBe('abc123');
    expect(payload.url).toContain('public');
    expect(payload.folder).toBe('astro-uploads');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/accounts/acct/images/v1',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('creates a webp variant when uploading an SVG', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct';
    process.env.CLOUDFLARE_API_TOKEN = 'token';

    let callCount = 0;
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // First call: upload SVG
        return Promise.resolve(new Response(
          JSON.stringify({
            result: {
              id: 'svg123',
              filename: 'vector.svg',
              uploaded: '2026-02-01T00:00:00.000Z',
              variants: ['https://example.com/svg123/public']
            }
          }),
          { status: 200 }
        ));
      } else if (callCount === 2) {
        // Second call: upload WebP variant
        return Promise.resolve(new Response(
          JSON.stringify({
            result: {
              id: 'webp789',
              filename: 'vector.webp',
              uploaded: '2026-02-01T00:00:01.000Z',
              variants: ['https://example.com/webp789/public']
            }
          }),
          { status: 200 }
        ));
      } else if (callCount === 3) {
        // Third call: PATCH to link assets
        return Promise.resolve(new Response(null, { status: 200 }));
      } else {
        // Subsequent calls: background cache refresh (return empty images)
        return Promise.resolve(new Response(
          JSON.stringify({ result: { images: [] } }),
          { status: 200 }
        ));
      }
    });

    // Valid SVG with explicit dimensions for sharp to process and unique content to avoid duplicate hash cache collisions
    const uniqueSvgSeed = `${Date.now()}-${Math.random()}`;
    const validSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="red"/><desc>${uniqueSvgSeed}</desc></svg>`;
    const file = new File([validSvg], 'vector.svg', { type: 'image/svg+xml' });
    const formData = new FormData();
    formData.append('file', file);
    formData.append('folder', 'icons');
    formData.append('namespace', 'icons');
    const request = createRequest(formData);

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.id).toBe('svg123');
    expect(payload.webpVariantId).toBe('webp789');
    // At least 3 calls: SVG upload, WebP upload, PATCH link (plus potential cache refresh)
    expect(mockFetch).toHaveBeenCalled();
    expect(callCount).toBeGreaterThanOrEqual(3);
  });

  it('accepts comfyWorkflowJson and marks upload as comfy-generated', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct';
    process.env.CLOUDFLARE_API_TOKEN = 'token';

    let uploadedMetadata: Record<string, unknown> | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
      if (typeof url === 'string' && url.endsWith('/images/v1') && init?.method === 'POST') {
        const body = init.body as FormData;
        const metadataRaw = body.get('metadata');
        uploadedMetadata = metadataRaw ? JSON.parse(String(metadataRaw)) : undefined;

        return Promise.resolve(new Response(
          JSON.stringify({
            result: {
              id: 'wf123',
              filename: 'image.png',
              uploaded: '2026-02-01T00:00:00.000Z',
              variants: ['https://imagedelivery.net/hash/wf123/public'],
              images: [],
            },
          }),
          { status: 200 }
        ));
      }

      return Promise.resolve(new Response(
        JSON.stringify({ result: { images: [] } }),
        { status: 200 }
      ));
    });

    const uniqueContent = `workflow-upload-${Date.now()}-${Math.random()}`;
    const file = new File([uniqueContent], 'image.png', { type: 'image/png' });
    const formData = new FormData();
    formData.append('file', file);
    formData.append('folder', 'comfy');
    formData.append('namespace', 'comfy');
    formData.append(
      'comfyWorkflowJson',
      JSON.stringify({
        '1': {
          class_type: 'CLIPTextEncode',
          inputs: { text: 'moody portrait lighting' },
        },
      })
    );

    const response = await POST(createRequest(formData));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.id).toBe('wf123');
    expect(uploadedMetadata?.generatedBy).toBe('comfyui');
    expect(uploadedMetadata?.comfyMetadataDetected).toBe(true);
    expect(uploadedMetadata?.comfyMetadataSource).toBe('request:comfyWorkflowJson');
  });

  it('rejects malformed comfyWorkflowJson', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct';
    process.env.CLOUDFLARE_API_TOKEN = 'token';

    const mockFetch = vi.spyOn(globalThis, 'fetch');

    const file = new File(['bad-json-image'], 'image.png', { type: 'image/png' });
    const formData = new FormData();
    formData.append('file', file);
    formData.append('namespace', 'comfy');
    formData.append('comfyWorkflowJson', '{bad-json');

    const response = await POST(createRequest(formData));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/Invalid comfyWorkflowJson/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('allows upload when originalUrl already exists but content hash is unique', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct';
    process.env.CLOUDFLARE_API_TOKEN = 'token';

    vi.spyOn(duplicateDetector, 'findDuplicatesByOriginalUrl').mockResolvedValue([
      {
        id: 'existing-url-1',
        filename: 'existing.png',
        uploaded: '2026-01-01T00:00:00.000Z',
        folder: 'existing-folder',
        variants: ['https://imagedelivery.net/hash/existing/public'],
      } as never,
    ]);
    vi.spyOn(duplicateDetector, 'findDuplicatesByContentHash').mockResolvedValue([]);

    const mockFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(new Response(
        JSON.stringify({
          result: {
            id: 'url-ok-123',
            filename: 'photo.png',
            uploaded: '2026-02-01T00:00:00.000Z',
            variants: ['https://imagedelivery.net/hash/url-ok-123/public'],
            images: [],
          },
        }),
        { status: 200 }
      ))
    );

    const file = new File([`unique-content-${Date.now()}-${Math.random()}`], 'photo.png', { type: 'image/png' });
    const formData = new FormData();
    formData.append('file', file);
    formData.append('originalUrl', 'https://example.com/dynamic-endpoint');
    formData.append('namespace', 'ns-a');

    const response = await POST(createRequest(formData));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.id).toBe('url-ok-123');
    expect(mockFetch).toHaveBeenCalled();
    expect(duplicateDetector.findDuplicatesByOriginalUrl).toHaveBeenCalled();
    expect(duplicateDetector.findDuplicatesByContentHash).toHaveBeenCalled();
  });

  it('blocks upload when content hash already exists even if originalUrl differs', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct';
    process.env.CLOUDFLARE_API_TOKEN = 'token';

    vi.spyOn(duplicateDetector, 'findDuplicatesByOriginalUrl').mockResolvedValue([]);
    vi.spyOn(duplicateDetector, 'findDuplicatesByContentHash').mockResolvedValue([
      {
        id: 'existing-hash-1',
        filename: 'existing-hash.png',
        uploaded: '2026-01-01T00:00:00.000Z',
        folder: 'hash-folder',
        variants: ['https://imagedelivery.net/hash/existing-hash/public'],
      } as never,
    ]);

    const mockFetch = vi.spyOn(globalThis, 'fetch');
    const file = new File([`duplicate-content-${Date.now()}-${Math.random()}`], 'photo.png', { type: 'image/png' });
    const formData = new FormData();
    formData.append('file', file);
    formData.append('originalUrl', 'https://example.com/another-endpoint');
    formData.append('namespace', 'ns-a');

    const response = await POST(createRequest(formData));
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error).toBe('Duplicate image content detected');
    expect(payload.duplicates?.[0]?.id).toBe('existing-hash-1');
    expect(mockFetch).not.toHaveBeenCalled();
    expect(duplicateDetector.findDuplicatesByContentHash).toHaveBeenCalled();
  });

  it('rejects uploads without an explicit namespace', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct';
    process.env.CLOUDFLARE_API_TOKEN = 'token';

    const file = new File(['image-bytes'], 'photo.png', { type: 'image/png' });
    const formData = new FormData();
    formData.append('file', file);

    const response = await POST(createRequest(formData));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/specific namespace is required/i);
  });
});
