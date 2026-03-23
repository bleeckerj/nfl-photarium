import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH } from '@/app/api/images/[id]/extras/route';

const { patchImageExtrasRecordMock } = vi.hoisted(() => ({
  patchImageExtrasRecordMock: vi.fn().mockResolvedValue({
    schemaVersion: 1,
    imageId: 'img_1',
    createdAt: '2026-03-22T00:00:00.000Z',
    updatedAt: '2026-03-22T00:00:00.000Z',
  }),
}));

vi.mock('@/server/imageExtras', () => ({
  getImageExtrasRecord: vi.fn(),
  patchImageExtrasRecord: patchImageExtrasRecordMock,
}));

function createPatchRequest(body: Record<string, unknown>) {
  const request = new Request('http://localhost/api/images/img_1/extras', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return new NextRequest(request);
}

describe('PATCH /api/images/:id/extras', () => {
  beforeEach(() => {
    patchImageExtrasRecordMock.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('accepts flickrSource payloads', async () => {
    const request = createPatchRequest({
      flickrSource: {
        photoId: '509900001',
        ownerNsid: '123@N45',
        albumTitles: ['Road Trip'],
        originalAvailable: true,
      },
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: 'img_1' }) });
    expect(response.status).toBe(200);
    expect(patchImageExtrasRecordMock).toHaveBeenCalledWith(
      'img_1',
      expect.objectContaining({
        flickrSource: expect.objectContaining({
          photoId: '509900001',
          albumTitles: ['Road Trip'],
          originalAvailable: true,
        }),
      })
    );
  });
});
