import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { POST } from '@/app/api/images/[id]/crop-variant/route';

const { createCropVariantMock } = vi.hoisted(() => ({
  createCropVariantMock: vi.fn(),
}));

vi.mock('@/server/cropVariantService', async () => {
  const actual = await vi.importActual<typeof import('@/server/cropVariantService')>('@/server/cropVariantService');
  return {
    ...actual,
    createCropVariant: createCropVariantMock,
  };
});

function createRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/images/img-1/crop-variant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/images/:id/crop-variant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createCropVariantMock.mockResolvedValue({
      id: 'variant-1',
      sourceImageId: 'img-1',
      sourceWidth: 1024,
      sourceHeight: 1280,
      mode: 'crop',
      crop: {
        width: 1024,
        height: 1024,
        aspectRatio: '1:1',
        anchor: 'center',
        x: 0,
        y: 128,
      },
      bytes: 1000,
      mimeType: 'image/webp',
      image: {},
    });
  });

  it('defaults old requests to deterministic crop mode', async () => {
    const response = await POST(
      createRequest({ aspectRatio: '1:1', anchor: 'center' }),
      { params: Promise.resolve({ id: 'img-1' }) }
    );

    expect(response.status).toBe(200);
    expect(createCropVariantMock).toHaveBeenCalledWith(expect.objectContaining({
      imageId: 'img-1',
      aspectRatio: '1:1',
      anchor: 'center',
      mode: 'crop',
      placement: 'center',
    }));
  });

  it('passes outpaint mode and placement to the crop variant service', async () => {
    await POST(
      createRequest({ aspectRatio: '1:1', mode: 'outpaint', placement: 'right' }),
      { params: Promise.resolve({ id: 'img-1' }) }
    );

    expect(createCropVariantMock).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'outpaint',
      placement: 'right',
    }));
  });
});
