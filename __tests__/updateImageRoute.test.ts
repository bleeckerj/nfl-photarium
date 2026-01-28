import { afterEach, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH } from '@/app/api/images/[id]/update/route';

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
    expect(payload.tags).toEqual(existingMeta.tags);

    const patchCall = mockFetch.mock.calls[1];
    const submittedBody = patchCall?.[1]?.body;
    const parsed = JSON.parse(String(submittedBody));
    expect(parsed.metadata.folder).toBe('new-folder');
    expect(parsed.metadata.tags).toEqual(existingMeta.tags);
    expect(parsed.metadata.variationParentId).toBe('new-parent');
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
});
