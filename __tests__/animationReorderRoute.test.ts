import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/images/[id]/animation/reorder/route';

const {
  fetchCloudflareImageMock,
  getCloudflareCredentialsMock,
  fetchOriginalImageBlobMock,
  reverseAnimatedWebpBufferMock,
  uploadImageBufferMock,
  patchImageExtrasRecordMock,
  deleteCloudflareImageWithArtifactsMock,
} = vi.hoisted(() => ({
  fetchCloudflareImageMock: vi.fn(),
  getCloudflareCredentialsMock: vi.fn(),
  fetchOriginalImageBlobMock: vi.fn(),
  reverseAnimatedWebpBufferMock: vi.fn(),
  uploadImageBufferMock: vi.fn(),
  patchImageExtrasRecordMock: vi.fn(),
  deleteCloudflareImageWithArtifactsMock: vi.fn(),
}));

vi.mock('@/server/cloudflareClient', () => ({
  fetchCloudflareImage: fetchCloudflareImageMock,
  getCloudflareCredentials: getCloudflareCredentialsMock,
}));

vi.mock('@/server/animatedWebpService', () => ({
  fetchOriginalImageBlob: fetchOriginalImageBlobMock,
  reverseAnimatedWebpBuffer: reverseAnimatedWebpBufferMock,
}));

vi.mock('@/server/uploadService', () => ({
  uploadImageBuffer: uploadImageBufferMock,
}));

vi.mock('@/server/imageExtras', () => ({
  patchImageExtrasRecord: patchImageExtrasRecordMock,
}));

vi.mock('@/server/cloudflareImageDeletion', () => ({
  deleteCloudflareImageWithArtifacts: deleteCloudflareImageWithArtifactsMock,
}));

const createRequest = (body: Record<string, unknown>) =>
  new NextRequest(
    new Request('http://localhost/api/images/source-1/animation/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );

const createParams = (id: string) => ({ params: Promise.resolve({ id }) });

describe('POST /api/images/[id]/animation/reorder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCloudflareCredentialsMock.mockReturnValue({ accountId: 'acct', apiToken: 'token' });
    fetchCloudflareImageMock.mockResolvedValue({
      id: 'source-1',
      filename: 'loop.webp',
      uploaded: '2026-01-01T00:00:00.000Z',
      variants: ['https://imagedelivery.net/hash/source-1/public'],
      meta: { tags: ['animated-webp'], namespace: 'studio' },
    });
    fetchOriginalImageBlobMock.mockResolvedValue({ buffer: Buffer.from('source-webp') });
    reverseAnimatedWebpBufferMock.mockResolvedValue({
      buffer: Buffer.from('reversed-webp'),
      bytes: 13,
      width: 10,
      height: 10,
      frameCount: 3,
      originalFrameCount: 3,
      delays: [300, 200, 100],
    });
    uploadImageBufferMock.mockResolvedValue({
      ok: true,
      data: {
        id: 'reversed-1',
        filename: 'loop-reversed.webp',
        url: 'https://imagedelivery.net/hash/reversed-1/public',
        variants: ['https://imagedelivery.net/hash/reversed-1/public'],
        uploaded: '2026-01-01T00:01:00.000Z',
        tags: ['animated-webp'],
      },
    });
  });

  it('creates a reversed copy without deleting the original', async () => {
    const response = await POST(createRequest({ mode: 'reverse' }), createParams('source-1'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.image.id).toBe('reversed-1');
    expect(uploadImageBufferMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'loop-reversed.webp',
        context: expect.objectContaining({
          parentId: 'source-1',
          namespace: 'studio',
        }),
      })
    );
    expect(deleteCloudflareImageWithArtifactsMock).not.toHaveBeenCalled();
  });

  it('uploads a replacement before deleting the original', async () => {
    const events: string[] = [];
    uploadImageBufferMock.mockImplementation(async () => {
      events.push('upload');
      return {
        ok: true,
        data: {
          id: 'reversed-1',
          filename: 'loop-reversed.webp',
          url: 'https://imagedelivery.net/hash/reversed-1/public',
          variants: ['https://imagedelivery.net/hash/reversed-1/public'],
          uploaded: '2026-01-01T00:01:00.000Z',
          tags: ['animated-webp'],
        },
      };
    });
    deleteCloudflareImageWithArtifactsMock.mockImplementation(async () => {
      events.push('delete');
    });

    const response = await POST(
      createRequest({ mode: 'reverse', replaceOriginal: true }),
      createParams('source-1')
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.replacedImageId).toBe('source-1');
    expect(events).toEqual(['upload', 'delete']);
    expect(deleteCloudflareImageWithArtifactsMock).toHaveBeenCalledWith('source-1');
  });

  it('does not delete the original when replacement upload fails', async () => {
    uploadImageBufferMock.mockResolvedValueOnce({
      ok: false,
      error: 'upload failed',
      status: 502,
    });

    const response = await POST(
      createRequest({ mode: 'reverse', replaceOriginal: true }),
      createParams('source-1')
    );
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload.error).toBe('upload failed');
    expect(deleteCloudflareImageWithArtifactsMock).not.toHaveBeenCalled();
  });

  it('rejects non-animated images', async () => {
    reverseAnimatedWebpBufferMock.mockRejectedValueOnce(new Error('Image is not animated'));

    const response = await POST(createRequest({ mode: 'reverse' }), createParams('source-1'));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/not animated/i);
    expect(uploadImageBufferMock).not.toHaveBeenCalled();
  });
});
