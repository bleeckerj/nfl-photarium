import { afterEach, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH } from '@/app/api/images/[id]/update/route';

const {
  validateParentAssignmentForExistingImageMock,
  patchImageExtrasRecordMock,
  upsertRegistryNamespaceMock,
  getCachedImagesMock,
  upsertCachedImageMock,
} = vi.hoisted(() => ({
  validateParentAssignmentForExistingImageMock: vi.fn().mockResolvedValue({ ok: true }),
  patchImageExtrasRecordMock: vi.fn().mockResolvedValue({
    schemaVersion: 1,
    imageId: 'child',
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  }),
  upsertRegistryNamespaceMock: vi.fn(),
  getCachedImagesMock: vi.fn(),
  upsertCachedImageMock: vi.fn(),
}));

vi.mock('@/server/parentValidation', () => ({
  validateParentAssignmentForExistingImage: validateParentAssignmentForExistingImageMock,
}));

vi.mock('@/server/imageExtras', () => ({
  patchImageExtrasRecord: patchImageExtrasRecordMock,
}));

vi.mock('@/server/namespaceRegistry', () => ({
  upsertRegistryNamespace: upsertRegistryNamespaceMock,
}));

vi.mock('@/server/cloudflareImageCache', () => ({
  getCachedImages: getCachedImagesMock,
  upsertCachedImage: upsertCachedImageMock,
  transformApiImageToCached: (image: { id: string; filename?: string; uploaded?: string; variants?: string[]; size?: number; meta?: unknown }) => {
    const parsedMeta =
      typeof image.meta === 'string'
        ? JSON.parse(image.meta)
        : image.meta && typeof image.meta === 'object'
          ? image.meta
          : {};
    return {
      id: image.id,
      filename: image.filename ?? image.id,
      uploaded: image.uploaded ?? '',
      variants: image.variants ?? [],
      size: image.size,
      ...parsedMeta,
    };
  },
}));

const ORIGINAL_ENV = { ...process.env };

function createRequest(body: Record<string, unknown>) {
  const base = new Request('http://localhost/api/images/parent-child', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return new NextRequest(base);
}

describe('PATCH /api/images/:id/update', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    validateParentAssignmentForExistingImageMock.mockResolvedValue({ ok: true });
    patchImageExtrasRecordMock.mockResolvedValue({
      schemaVersion: 1,
      imageId: 'child',
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
    upsertRegistryNamespaceMock.mockResolvedValue(undefined);
    getCachedImagesMock.mockResolvedValue([]);
    upsertCachedImageMock.mockReset();
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

  it('merges existing metadata and honors optional fields', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch');

    const existingMeta = {
      tags: ['hero'],
      variationParentId: 'parent-old',
      folder: 'campaigns',
    };

    mockFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: {
              id: 'child',
              meta: JSON.stringify(existingMeta),
            },
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: {},
          }),
          { status: 200 }
        )
      );

    const request = createRequest({ folder: 'new-folder', parentId: 'new-parent' });
    const response = await PATCH(request, { params: Promise.resolve({ id: 'child' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.parentId).toBe('new-parent');
    expect(payload.folder).toBe('new-folder');
    expect(payload.tags).toEqual(existingMeta.tags);

    const patchCall = mockFetch.mock.calls[1];
    const submittedBody = patchCall?.[1]?.body;
    const parsed = JSON.parse(String(submittedBody));
    expect(parsed.metadata.folder).toBeUndefined();
    expect(parsed.metadata.tags).toEqual(existingMeta.tags);
    expect(parsed.metadata.variationParentId).toBe('new-parent');
    expect(patchImageExtrasRecordMock).toHaveBeenCalledWith(
      'child',
      expect.objectContaining({ folder: 'new-folder' })
    );
  });

  it('detaches the child from its parent when empty parentId provided', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch');

    const existingMeta = {
      variationParentId: 'parent-old',
    };

    mockFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: {
              id: 'child',
              meta: JSON.stringify(existingMeta),
            },
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: {},
          }),
          { status: 200 }
        )
      );

    const request = createRequest({ parentId: '' });
    const response = await PATCH(request, { params: Promise.resolve({ id: 'child' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.parentId).toBeUndefined();

    const patchCall = mockFetch.mock.calls[1];
    const submittedBody = patchCall?.[1]?.body;
    const parsed = JSON.parse(String(submittedBody));
    expect(parsed.metadata.variationParentId).toBe('');
    expect(payload.folder).toBeUndefined();
    expect(payload.tags).toEqual([]);
  });

  it('rejects empty namespace updates', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch');

    const request = createRequest({ namespace: '' });
    const response = await PATCH(request, { params: Promise.resolve({ id: 'child' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('A non-empty namespace is required.');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('moves the whole image family to a namespace and registers it', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch');
    getCachedImagesMock.mockResolvedValue([
      { id: 'parent', parentId: undefined },
      { id: 'child', parentId: 'parent' },
      { id: 'unrelated', parentId: undefined },
    ]);

    const makeFetchResponse = (targetId: string, meta: Record<string, unknown>) =>
      new Response(
        JSON.stringify({
          result: {
            id: targetId,
            filename: `${targetId}.png`,
            uploaded: '2026-02-01T00:00:00.000Z',
            variants: ['https://example.com/public'],
            meta: JSON.stringify(meta),
          },
        }),
        { status: 200 }
      );

    // Family members update concurrently, so dispatch mock responses by
    // URL/method instead of call order.
    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'PATCH') {
        return new Response(JSON.stringify({ result: {} }), { status: 200 });
      }
      if (url.includes('/child')) {
        return makeFetchResponse('child', { namespace: 'old-space', variationParentId: 'parent' });
      }
      return makeFetchResponse('parent', { namespace: 'old-space' });
    });

    const request = createRequest({
      namespace: 'new-space',
      applyToFamily: true,
      applyToFamilyFields: ['namespace'],
    });
    const response = await PATCH(request, { params: Promise.resolve({ id: 'parent' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.namespace).toBe('new-space');
    expect([...payload.updatedIds].sort()).toEqual(['child', 'parent']);
    expect(upsertRegistryNamespaceMock).toHaveBeenCalledWith('new-space');

    const patchBodies = mockFetch.mock.calls
      .filter(([, init]) => init?.method === 'PATCH')
      .map((call) => JSON.parse(String(call?.[1]?.body)));
    expect(patchBodies).toHaveLength(2);
    expect(patchBodies).toEqual([
      expect.objectContaining({ metadata: expect.objectContaining({ namespace: 'new-space' }) }),
      expect.objectContaining({ metadata: expect.objectContaining({ namespace: 'new-space' }) }),
    ]);
  });

  it('stores long description in extras without writing it to Cloudflare metadata', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch');
    const longDescription = 'A'.repeat(4000);

    mockFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: {
              id: 'child',
              filename: 'child.png',
              uploaded: '2026-02-01T00:00:00.000Z',
              variants: ['https://example.com/public'],
              meta: JSON.stringify({}),
            },
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ result: {} }),
          { status: 200 }
        )
      );

    const request = createRequest({ description: longDescription });
    const response = await PATCH(request, { params: Promise.resolve({ id: 'child' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.description).toBe(longDescription);

    const patchCall = mockFetch.mock.calls[1];
    const submittedBody = patchCall?.[1]?.body;
    const parsed = JSON.parse(String(submittedBody));

    expect(parsed.metadata.description).toBeUndefined();

    expect(patchImageExtrasRecordMock).toHaveBeenCalledWith(
      'child',
      expect.objectContaining({ description: longDescription })
    );
  });

  it('stores a cleared folder in extras without writing stale Cloudflare folder metadata', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch');

    mockFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: {
              id: 'child',
              filename: 'child.png',
              uploaded: '2026-02-01T00:00:00.000Z',
              variants: ['https://example.com/public'],
              meta: JSON.stringify({ folder: 'old-folder' }),
            },
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ result: {} }),
          { status: 200 }
        )
      );

    const request = createRequest({ folder: '' });
    const response = await PATCH(request, { params: Promise.resolve({ id: 'child' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.folder).toBe('');

    const patchCall = mockFetch.mock.calls[1];
    const submittedBody = patchCall?.[1]?.body;
    const parsed = JSON.parse(String(submittedBody));
    expect(parsed.metadata.folder).toBeUndefined();

    expect(patchImageExtrasRecordMock).toHaveBeenCalledWith(
      'child',
      expect.objectContaining({ folder: '' })
    );
  });

  it('preserves hidden system tags when replacing user tags', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch');

    mockFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: {
              id: 'child',
              filename: 'child.png',
              uploaded: '2026-02-01T00:00:00.000Z',
              variants: ['https://example.com/public'],
              meta: JSON.stringify({ tags: ['old', '_favorite_'] }),
            },
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ result: {} }),
          { status: 200 }
        )
      );

    const request = createRequest({ tags: ['hero'] });
    const response = await PATCH(request, { params: Promise.resolve({ id: 'child' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.tags).toEqual(['hero', '_favorite_']);

    const patchCall = mockFetch.mock.calls[1];
    const submittedBody = patchCall?.[1]?.body;
    const parsed = JSON.parse(String(submittedBody));
    expect(parsed.metadata.tags).toEqual(['hero', '_favorite_']);
  });
});
