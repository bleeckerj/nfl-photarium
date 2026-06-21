import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/upload/route';

const ORIGINAL_ENV = { ...process.env };

const {
  uploadImageBufferMock,
  validateParentForNewChildMock,
  upsertRegistryNamespaceMock,
} = vi.hoisted(() => ({
  uploadImageBufferMock: vi.fn(),
  validateParentForNewChildMock: vi.fn(),
  upsertRegistryNamespaceMock: vi.fn(),
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

vi.mock('@/server/namespaceRegistry', () => ({
  upsertRegistryNamespace: upsertRegistryNamespaceMock,
}));

vi.mock('@/server/promptThis', () => ({
  getPromptThisRecord: vi.fn(),
  setPromptThisRecord: vi.fn(),
}));

const createRequest = (formData: FormData) =>
  new NextRequest(
    new Request('http://localhost/api/upload', {
      method: 'POST',
      body: formData,
    })
  );

describe('POST /api/upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct';
    process.env.CLOUDFLARE_API_TOKEN = 'token';

    validateParentForNewChildMock.mockResolvedValue({
      ok: true,
      canonicalParentId: undefined,
      canonicalParentNamespace: undefined,
    });

    uploadImageBufferMock.mockResolvedValue({
      ok: true,
      data: {
        id: 'img-1',
        filename: 'photo.png',
        uploaded: '2026-03-07T00:00:00.000Z',
        variants: ['https://imagedelivery.net/hash/img-1/public'],
      },
    });
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('inherits the canonical parent namespace for variation file uploads', async () => {
    validateParentForNewChildMock.mockResolvedValue({
      ok: true,
      canonicalParentId: 'parent-123',
      canonicalParentNamespace: 'ns-parent',
    });

    const formData = new FormData();
    formData.append('file', new File(['image-bytes'], 'photo.png', { type: 'image/png' }));
    formData.append('parentId', 'variant-456');

    const response = await POST(createRequest(formData));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.id).toBe('img-1');
    expect(uploadImageBufferMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          namespace: 'ns-parent',
          parentId: 'parent-123',
        }),
      })
    );
    expect(upsertRegistryNamespaceMock).toHaveBeenCalledWith('ns-parent');
  });

  it('passes duplicate override through to the shared upload service context', async () => {
    const formData = new FormData();
    formData.append('file', new File(['image-bytes'], 'photo.png', { type: 'image/png' }));
    formData.append('namespace', 'ns-a');
    formData.append('duplicateAction', 'override');

    const response = await POST(createRequest(formData));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.id).toBe('img-1');
    expect(uploadImageBufferMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          duplicateAction: 'override',
        }),
      })
    );
  });
});
