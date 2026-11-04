import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  loadImageDeletePlanMock,
  applyImageDeletePlanMock,
  getVideoAssetRecordMock,
  deleteVideoAssetRecordMock,
  listVideoAssetRecordsMock,
  deleteStreamVideoMock,
  cleanupImageArtifactsMock,
  getCloudflareCredentialsMock,
} = vi.hoisted(() => ({
  loadImageDeletePlanMock: vi.fn(),
  applyImageDeletePlanMock: vi.fn(),
  getVideoAssetRecordMock: vi.fn(),
  deleteVideoAssetRecordMock: vi.fn(),
  listVideoAssetRecordsMock: vi.fn(),
  deleteStreamVideoMock: vi.fn(),
  cleanupImageArtifactsMock: vi.fn(),
  getCloudflareCredentialsMock: vi.fn(),
}));

vi.mock('@/server/imageDeleteFamilyPlan', () => ({
  loadImageDeletePlan: loadImageDeletePlanMock,
  applyImageDeletePlan: applyImageDeletePlanMock,
  ImageDeleteFamilyUpdateError: class ImageDeleteFamilyUpdateError extends Error {},
}));

vi.mock('@/server/videoCatalogStorage', () => ({
  getVideoAssetRecord: getVideoAssetRecordMock,
  deleteVideoAssetRecord: deleteVideoAssetRecordMock,
  listVideoAssetRecords: listVideoAssetRecordsMock,
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
    loadImageDeletePlanMock.mockResolvedValue({
      plan: { parentId: 'parent-1', newParent: { id: 'child-1', filename: 'child.jpg' }, childIds: ['child-1'], signature: 'plan' },
      assets: [],
    });
    applyImageDeletePlanMock.mockResolvedValue(undefined);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ result: {} }), { status: 200 })
    );
  });

  it('promotes variants before deleting the parent', async () => {
    const events: string[] = [];
    applyImageDeletePlanMock.mockImplementation(async () => { events.push('promote'); });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      events.push('delete');
      return new Response(JSON.stringify({ result: {} }), { status: 200 });
    });
    const response = await DELETE(createRequest(), createParams('parent-1'));
    expect(response.status).toBe(200);
    expect(events).toEqual(['promote', 'delete']);
    expect((await response.json()).newParentId).toBe('child-1');
  });

  it('does not delete the parent if an update fails', async () => {
    applyImageDeletePlanMock.mockRejectedValueOnce(new Error('patch failed'));
    const response = await DELETE(createRequest(), createParams('parent-1'));
    expect(response.status).toBe(502);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects a stale confirmed plan before changing links', async () => {
    const request = new NextRequest('http://localhost/api/images/parent-1?familyPlan=old', { method: 'DELETE' });
    const response = await DELETE(request, createParams('parent-1'));
    expect(response.status).toBe(409);
    expect(applyImageDeletePlanMock).not.toHaveBeenCalled();
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
