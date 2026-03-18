import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  assignAssetParentMock,
  ParentAssignmentErrorMock,
} = vi.hoisted(() => {
  class ParentAssignmentErrorMock extends Error {
    status: number;

    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }

  return {
    assignAssetParentMock: vi.fn(),
    ParentAssignmentErrorMock,
  };
});

vi.mock('@/server/assetParentService', () => ({
  assignAssetParent: assignAssetParentMock,
  ParentAssignmentError: ParentAssignmentErrorMock,
}));

import { PATCH } from '@/app/api/assets/[id]/parent/route';

describe('PATCH /api/assets/:id/parent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('assigns parent and returns success payload', async () => {
    assignAssetParentMock.mockResolvedValue({
      targetId: 'video-1',
      targetAssetType: 'video',
      parentId: 'image-1',
      canonicalParentId: 'image-1',
    });

    const req = new NextRequest('http://localhost/api/assets/video-1/parent', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parentId: 'image-1' }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'video-1' }) });
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(assignAssetParentMock).toHaveBeenCalledWith('video-1', 'image-1');
    expect(payload).toEqual(
      expect.objectContaining({
        success: true,
        targetId: 'video-1',
        targetAssetType: 'video',
        parentId: 'image-1',
      })
    );
  });

  it('maps service validation errors to HTTP status', async () => {
    assignAssetParentMock.mockRejectedValue(new ParentAssignmentErrorMock(400, 'Parent asset must be an image.'));

    const req = new NextRequest('http://localhost/api/assets/video-1/parent', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parentId: 'video-2' }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'video-1' }) });
    const payload = await res.json();

    expect(res.status).toBe(400);
    expect(payload).toEqual({ error: 'Parent asset must be an image.' });
  });
});
