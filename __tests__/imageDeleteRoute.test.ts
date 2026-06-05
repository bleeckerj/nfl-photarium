import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  detachAssetChildrenMock,
  getVideoAssetRecordMock,
  deleteVideoAssetRecordMock,
  deleteStreamVideoMock,
  cleanupImageArtifactsMock,
  getCloudflareCredentialsMock,
} = vi.hoisted(() => ({
  detachAssetChildrenMock: vi.fn(),
  getVideoAssetRecordMock: vi.fn(),
  deleteVideoAssetRecordMock: vi.fn(),
  deleteStreamVideoMock: vi.fn(),
  cleanupImageArtifactsMock: vi.fn(),
  getCloudflareCredentialsMock: vi.fn(),
}));

vi.mock('@/server/assetParentService', () => ({
  detachAssetChildren: detachAssetChildrenMock,
  ParentAssignmentError: class ParentAssignmentError extends Error {
    status: number;

    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock('@/server/videoCatalogStorage', () => ({
  getVideoAssetRecord: getVideoAssetRecordMock,
  deleteVideoAssetRecord: deleteVideoAssetRecordMock,
}));

vi.mock('@/server/cloudflareStreamClient', () => ({
  deleteStreamVideo: deleteStreamVideoMock,
}));

vi.mock('@/server/imageArtifactCleanup', () => ({
  cleanupImageArtifacts: cleanupImageArtifactsMock,
}));

vi.mock('@/server/cloudflareClient', () => ({
  getCloudflareCredentials: getCloudflareCredentialsMock,
  fetchCloudflareImage: vi.fn(),
}));

vi.mock('@/server/cloudflareImageCache', () => ({
  getCachedImage: vi.fn(),
  transformApiImageToCached: vi.fn(),
  upsertCachedImage: vi.fn(),
}));

vi.mock('@/server/animatedImageProbe', () => ({
  probeAnimatedImageFromOriginalBlob: vi.fn(),
}));

vi.mock('@/server/vectorSearch', () => ({
  batchGetAspectMetadata: vi.fn(),
  batchGetColorMetadata: vi.fn(),
  isVectorSearchAvailable: vi.fn(),
}));

vi.mock('@/server/imageExtras', () => ({
  getImageExtrasRecord: vi.fn(),
}));

import { DELETE } from '@/app/api/images/[id]/route';

const createRequest = () =>
  new NextRequest('http://localhost/api/images/parent-1', { method: 'DELETE' });

const createParams = (id: string) => ({ params: Promise.resolve({ id }) });

describe('DELETE /api/images/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getVideoAssetRecordMock.mockResolvedValue(null);
    getCloudflareCredentialsMock.mockReturnValue({ accountId: 'acct', apiToken: 'token' });
    cleanupImageArtifactsMock.mockResolvedValue({ success: true, steps: [] });
    detachAssetChildrenMock.mockResolvedValue({
      parentId: 'parent-1',
      childIds: ['child-1'],
      detachedIds: ['child-1'],
      failed: [],
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ result: {} }), { status: 200 })
    );
  });

  it('detaches child variants before deleting the parent Cloudflare image', async () => {
    const events: string[] = [];
    detachAssetChildrenMock.mockImplementation(async () => {
      events.push('detach');
      return {
        parentId: 'parent-1',
        childIds: ['child-1'],
        detachedIds: ['child-1'],
        failed: [],
      };
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      events.push('delete');
      return new Response(JSON.stringify({ result: {} }), { status: 200 });
    });

    const response = await DELETE(createRequest(), createParams('parent-1'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(events).toEqual(['detach', 'delete']);
    expect(detachAssetChildrenMock).toHaveBeenCalledWith('parent-1', {
      forceRefreshImages: false,
      includeVideos: false,
    });
    expect(payload.detachedChildIds).toEqual(['child-1']);
  });

  it('does not delete the parent when child detach fails', async () => {
    detachAssetChildrenMock.mockResolvedValueOnce({
      parentId: 'parent-1',
      childIds: ['child-1'],
      detachedIds: [],
      failed: [{ id: 'child-1', status: 502, message: 'patch failed' }],
    });

    const response = await DELETE(createRequest(), createParams('parent-1'));
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload.error).toMatch(/detach/i);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('returns a timeout response when the Cloudflare delete aborts', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(abortError);

    const response = await DELETE(createRequest(), createParams('parent-1'));
    const payload = await response.json();

    expect(response.status).toBe(504);
    expect(payload.error).toMatch(/timed out/i);
    expect(cleanupImageArtifactsMock).not.toHaveBeenCalled();
  });
});
