import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { searchByReferenceImageMock } = vi.hoisted(() => ({
  searchByReferenceImageMock: vi.fn(),
}));

vi.mock('@/server/imageSearchUpload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/imageSearchUpload')>();
  return {
    ...actual,
    searchByReferenceImage: searchByReferenceImageMock,
  };
});

import { POST } from '@/app/api/images/search/upload/route';
import { MAX_REFERENCE_BYTES, ReferenceDecodeError } from '@/server/imageSearchUpload';

const buildRequest = (formData: FormData) =>
  new NextRequest(
    new Request('http://localhost/api/images/search/upload', {
      method: 'POST',
      body: formData,
    })
  );

const buildFileRequest = (bytes: Buffer | Uint8Array, extraFields: Record<string, string> = {}) => {
  const formData = new FormData();
  formData.append('file', new File([bytes as BlobPart], 'reference.png', { type: 'image/png' }));
  for (const [key, value] of Object.entries(extraFields)) {
    formData.append(key, value);
  }
  return buildRequest(formData);
};

const emptyOutcome = {
  exactMatches: [],
  results: [],
  coverage: { totalImages: 0, withClip: 0, notIndexed: 0 },
  warnings: [],
};

describe('POST /api/images/search/upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when no file is provided', async () => {
    const response = await POST(buildRequest(new FormData()));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('file');
  });

  it('returns 400 for an oversized file', async () => {
    const response = await POST(buildFileRequest(Buffer.alloc(MAX_REFERENCE_BYTES + 1)));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('maximum size');
    expect(searchByReferenceImageMock).not.toHaveBeenCalled();
  });

  it('returns 400 when the reference cannot be decoded', async () => {
    searchByReferenceImageMock.mockRejectedValue(new ReferenceDecodeError('Unsupported format'));
    const response = await POST(buildFileRequest(Buffer.from('garbage')));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Unsupported format');
  });

  it('returns 503 when vector search is down and there are no exact matches', async () => {
    searchByReferenceImageMock.mockResolvedValue({
      ...emptyOutcome,
      warnings: ['vector-search-unavailable'],
    });
    const response = await POST(buildFileRequest(Buffer.from('bytes')));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toContain('Redis Stack');
  });

  it('returns 200 with exact matches even when vector search is down', async () => {
    searchByReferenceImageMock.mockResolvedValue({
      ...emptyOutcome,
      exactMatches: [{ imageId: 'img-1', id: 'img-1', canonicalImageId: 'img-1', score: 1 }],
      warnings: ['vector-search-unavailable'],
    });
    const response = await POST(buildFileRequest(Buffer.from('bytes')));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.exactMatches).toHaveLength(1);
    expect(body.warnings).toEqual(['vector-search-unavailable']);
  });

  it('returns the full response shape and forwards limit/namespace', async () => {
    searchByReferenceImageMock.mockResolvedValue({
      exactMatches: [],
      results: [{ imageId: 'img-2', id: 'img-2', canonicalImageId: 'img-2', score: 0.2 }],
      coverage: { totalImages: 10, withClip: 8, notIndexed: 2 },
      warnings: [],
    });

    const response = await POST(
      buildFileRequest(Buffer.from('bytes'), { limit: '7', namespace: 'ns1' })
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      type: 'upload',
      count: 1,
      coverage: { totalImages: 10, withClip: 8, notIndexed: 2 },
      warnings: [],
    });
    expect(searchByReferenceImageMock).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({ limit: 7, namespace: 'ns1', fileName: 'reference.png' })
    );
  });

  it('returns 500 on unexpected errors', async () => {
    searchByReferenceImageMock.mockRejectedValue(new Error('boom'));
    const response = await POST(buildFileRequest(Buffer.from('bytes')));
    expect(response.status).toBe(500);
  });
});
