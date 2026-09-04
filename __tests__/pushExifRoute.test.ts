import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { propagateImageExifMock, ExifPropagationErrorMock } = vi.hoisted(() => {
  class ExifPropagationErrorMock extends Error {
    status: number;

    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return { propagateImageExifMock: vi.fn(), ExifPropagationErrorMock };
});

vi.mock('@/server/exifPropagationService', async () => {
  const actual = await vi.importActual<typeof import('@/server/exifPropagationService')>(
    '@/server/exifPropagationService'
  );
  return {
    normalizeExifPropagationMode: actual.normalizeExifPropagationMode,
    propagateImageExif: propagateImageExifMock,
    ExifPropagationError: ExifPropagationErrorMock,
  };
});

import { POST } from '@/app/api/images/[id]/push-exif/route';

const baseResult = {
  sourceId: 'root',
  familyRootId: 'root',
  relation: 'parent' as const,
  mode: 'fill-missing' as const,
  dryRun: false,
  exif: { make: 'Apple' },
  targetIds: ['a', 'b'],
  updatedIds: ['a'],
  skipped: [{ id: 'b', reason: 'already-has-exif' as const }],
  failed: [],
};

const makeRequest = (body?: unknown) =>
  new NextRequest('http://localhost/api/images/root/push-exif', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe('POST /api/images/:id/push-exif', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults to fill-missing and reports the outcome', async () => {
    propagateImageExifMock.mockResolvedValue(baseResult);

    const res = await POST(makeRequest({}), { params: Promise.resolve({ id: 'root' }) });
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(propagateImageExifMock).toHaveBeenCalledWith('root', {
      mode: 'fill-missing',
      dryRun: false,
      concurrency: 4,
    });
    expect(payload).toEqual(
      expect.objectContaining({
        success: true,
        requestedId: 'root',
        relation: 'parent',
        updatedIds: ['a'],
        skipped: [{ id: 'b', reason: 'already-has-exif' }],
      })
    );
  });

  it('passes overwrite mode and dry-run through', async () => {
    propagateImageExifMock.mockResolvedValue({ ...baseResult, mode: 'overwrite', dryRun: true });

    const res = await POST(makeRequest({ mode: 'overwrite', dryRun: true, concurrency: 99 }), {
      params: Promise.resolve({ id: 'root' }),
    });

    expect(res.status).toBe(200);
    expect(propagateImageExifMock).toHaveBeenCalledWith('root', expect.objectContaining({
      mode: 'overwrite',
      dryRun: true,
      concurrency: 8,
    }));
  });

  it('returns 207 when some targets failed', async () => {
    propagateImageExifMock.mockResolvedValue({
      ...baseResult,
      failed: [{ id: 'b', status: 500, message: 'redis down' }],
    });

    const res = await POST(makeRequest({}), { params: Promise.resolve({ id: 'root' }) });
    const payload = await res.json();

    expect(res.status).toBe(207);
    expect(payload.success).toBe(false);
  });

  it('maps service errors to their status', async () => {
    propagateImageExifMock.mockRejectedValue(new ExifPropagationErrorMock(400, 'This image has no EXIF data to push.'));

    const res = await POST(makeRequest({}), { params: Promise.resolve({ id: 'root' }) });
    const payload = await res.json();

    expect(res.status).toBe(400);
    expect(payload.error).toBe('This image has no EXIF data to push.');
  });
});
