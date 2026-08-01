import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { DELETE, GET, PATCH, POST } from '@/app/api/namespaces/route';

const {
  listRegistryNamespaceDetailsMock,
  upsertRegistryNamespaceMock,
  removeRegistryNamespaceMock,
  renameRegistryNamespaceMock,
  getCachedImagesMock,
  listVideoAssetRecordsMock,
  updateVideoAssetRecordMock,
  patchCloudflareImageMetadataMock,
} = vi.hoisted(() => ({
  listRegistryNamespaceDetailsMock: vi.fn(),
  upsertRegistryNamespaceMock: vi.fn(),
  removeRegistryNamespaceMock: vi.fn(),
  renameRegistryNamespaceMock: vi.fn(),
  getCachedImagesMock: vi.fn(),
  listVideoAssetRecordsMock: vi.fn(),
  updateVideoAssetRecordMock: vi.fn(),
  patchCloudflareImageMetadataMock: vi.fn(),
}));

vi.mock('@/server/namespaceRegistry', () => ({
  DEFAULT_NAMESPACE: 'cf-default',
  getRegistryUpdatedAt: async () => '2026-01-01T00:00:00.000Z',
  listRegistryNamespaceDetails: listRegistryNamespaceDetailsMock,
  upsertRegistryNamespace: upsertRegistryNamespaceMock,
  removeRegistryNamespace: removeRegistryNamespaceMock,
  renameRegistryNamespace: renameRegistryNamespaceMock,
  normalizeRegistryNamespace: (value?: string) => {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return trimmed && trimmed !== '__all__' && trimmed !== '__none__' ? trimmed : '';
  },
  isProtectedRegistryNamespace: (value?: string) => {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return !trimmed || trimmed === 'cf-default' || trimmed === 'cf-site-misc';
  },
}));

vi.mock('@/server/cloudflareImageCache', () => ({
  getCachedImages: getCachedImagesMock,
  getCacheStats: () => ({ contentVersion: 7 }),
}));

vi.mock('@/server/videoCatalogStorage', () => ({
  listVideoAssetRecords: listVideoAssetRecordsMock,
  updateVideoAssetRecord: updateVideoAssetRecordMock,
  getVideoAssetCatalogVersion: () => 0,
}));

vi.mock('@/server/cloudflareImageMetadata', () => ({
  patchCloudflareImageMetadata: patchCloudflareImageMetadataMock,
}));

describe('/api/namespaces', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listRegistryNamespaceDetailsMock.mockResolvedValue([
      { name: 'cf-default', description: 'Default namespace' },
      { name: 'new-space', description: '' },
    ]);
    getCachedImagesMock.mockResolvedValue([
      { namespace: 'cf-default' },
      { namespace: '  discovered-space  ' },
      { namespace: '' },
      {},
    ]);
    listVideoAssetRecordsMock.mockResolvedValue([]);
    patchCloudflareImageMetadataMock.mockResolvedValue({});
    updateVideoAssetRecordMock.mockImplementation(async (id: string, patch: Record<string, unknown>) => ({
      id,
      ...patch,
    }));
    removeRegistryNamespaceMock.mockResolvedValue(true);
    renameRegistryNamespaceMock.mockResolvedValue(true);
  });

  it('returns merged namespaces with revalidation headers', async () => {
    const response = await GET(new NextRequest('http://localhost/api/namespaces'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('no-cache');
    expect(response.headers.get('ETag')).toBeTruthy();
    expect(payload).toEqual({
      namespaces: ['cf-default', 'discovered-space', 'new-space'],
      namespaceDetails: [
        { name: 'cf-default', description: 'Default namespace' },
        { name: 'discovered-space', description: '' },
        { name: 'new-space', description: '' },
      ],
    });
  });

  it('answers 304 when the If-None-Match tag still matches', async () => {
    const first = await GET(new NextRequest('http://localhost/api/namespaces'));
    const etag = first.headers.get('ETag');
    expect(etag).toBeTruthy();

    const second = await GET(new NextRequest('http://localhost/api/namespaces', {
      headers: { 'if-none-match': etag as string },
    }));
    expect(second.status).toBe(304);
    expect(second.headers.get('ETag')).toBe(etag);
  });

  it('registers a namespace with a description and returns the refreshed list', async () => {
    const request = new NextRequest('http://localhost/api/namespaces', {
      method: 'POST',
      body: JSON.stringify({ namespace: 'brand-new', description: 'Brand assets' }),
      headers: { 'Content-Type': 'application/json' },
    });

    listRegistryNamespaceDetailsMock.mockResolvedValueOnce([
      { name: 'brand-new', description: 'Brand assets' },
      { name: 'cf-default', description: 'Default namespace' },
      { name: 'new-space', description: '' },
    ]);

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(upsertRegistryNamespaceMock).toHaveBeenCalledWith('brand-new', 'Brand assets');
    expect(payload).toEqual({
      namespaces: ['brand-new', 'cf-default', 'discovered-space', 'new-space'],
      namespaceDetails: [
        { name: 'brand-new', description: 'Brand assets' },
        { name: 'cf-default', description: 'Default namespace' },
        { name: 'discovered-space', description: '' },
        { name: 'new-space', description: '' },
      ],
    });
  });

  it('rejects empty namespace registrations', async () => {
    const request = new NextRequest('http://localhost/api/namespaces', {
      method: 'POST',
      body: JSON.stringify({ namespace: '   ' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(upsertRegistryNamespaceMock).not.toHaveBeenCalled();
    expect(payload).toEqual({ error: 'A non-empty namespace is required.' });
  });

  it('previews namespace deletion without moving assets', async () => {
    getCachedImagesMock.mockResolvedValueOnce([
      { id: 'img-1', namespace: 'old-space' },
      { id: 'img-2', namespace: 'cf-default' },
    ]);
    listVideoAssetRecordsMock.mockResolvedValueOnce([
      { id: 'vid-1', namespace: 'old-space' },
      { id: 'vid-2', namespace: 'other-space' },
    ]);
    const request = new NextRequest('http://localhost/api/namespaces', {
      method: 'DELETE',
      body: JSON.stringify({ namespace: 'old-space', dryRun: true }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await DELETE(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual(expect.objectContaining({
      namespace: 'old-space',
      targetNamespace: 'cf-default',
      dryRun: true,
      imageCount: 1,
      videoCount: 1,
      imageIds: ['img-1'],
      videoIds: ['vid-1'],
      movedImageIds: [],
      movedVideoIds: [],
      failures: [],
    }));
    expect(patchCloudflareImageMetadataMock).not.toHaveBeenCalled();
    expect(updateVideoAssetRecordMock).not.toHaveBeenCalled();
    expect(removeRegistryNamespaceMock).not.toHaveBeenCalled();
  });

  it('deletes a namespace by moving images and videos to cf-default', async () => {
    getCachedImagesMock
      .mockResolvedValueOnce([
        { id: 'img-1', namespace: 'old-space' },
        { id: 'img-2', namespace: 'cf-default' },
      ])
      .mockResolvedValueOnce([
        { id: 'img-1', namespace: 'cf-default' },
        { id: 'img-2', namespace: 'cf-default' },
      ]);
    listVideoAssetRecordsMock
      .mockResolvedValueOnce([
        { id: 'vid-1', namespace: 'old-space' },
      ])
      .mockResolvedValueOnce([
        { id: 'vid-1', namespace: 'cf-default' },
      ]);
    listRegistryNamespaceDetailsMock.mockResolvedValueOnce([
      { name: 'cf-default', description: 'Default namespace' },
    ]);
    const request = new NextRequest('http://localhost/api/namespaces', {
      method: 'DELETE',
      body: JSON.stringify({ namespace: 'old-space' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await DELETE(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(upsertRegistryNamespaceMock).toHaveBeenCalledWith('cf-default');
    expect(patchCloudflareImageMetadataMock).toHaveBeenCalledWith(
      'img-1',
      expect.any(Function),
      { requiredKeys: ['namespace'] }
    );
    expect(updateVideoAssetRecordMock).toHaveBeenCalledWith('vid-1', { namespace: 'cf-default' });
    expect(removeRegistryNamespaceMock).toHaveBeenCalledWith('old-space');
    expect(payload).toEqual(expect.objectContaining({
      partialFailure: false,
      movedImageIds: ['img-1'],
      movedVideoIds: ['vid-1'],
      namespaces: ['cf-default'],
    }));
  });

  it('rejects protected namespace deletion', async () => {
    const request = new NextRequest('http://localhost/api/namespaces', {
      method: 'DELETE',
      body: JSON.stringify({ namespace: 'cf-default' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await DELETE(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/cannot be deleted/i);
    expect(getCachedImagesMock).not.toHaveBeenCalled();
  });

  it('previews namespace rename without moving assets', async () => {
    getCachedImagesMock.mockResolvedValueOnce([
      { id: 'img-1', namespace: 'old-space' },
      { id: 'img-2', namespace: 'cf-default' },
    ]);
    listVideoAssetRecordsMock.mockResolvedValueOnce([
      { id: 'vid-1', namespace: 'old-space' },
      { id: 'vid-2', namespace: 'other-space' },
    ]);
    const request = new NextRequest('http://localhost/api/namespaces', {
      method: 'PATCH',
      body: JSON.stringify({ namespace: 'old-space', targetNamespace: 'new-space-name', dryRun: true }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await PATCH(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual(expect.objectContaining({
      namespace: 'old-space',
      targetNamespace: 'new-space-name',
      dryRun: true,
      imageCount: 1,
      videoCount: 1,
      imageIds: ['img-1'],
      videoIds: ['vid-1'],
      movedImageIds: [],
      movedVideoIds: [],
      failures: [],
    }));
    expect(patchCloudflareImageMetadataMock).not.toHaveBeenCalled();
    expect(updateVideoAssetRecordMock).not.toHaveBeenCalled();
    expect(renameRegistryNamespaceMock).not.toHaveBeenCalled();
  });

  it('renames a namespace by moving images and videos to the target namespace', async () => {
    getCachedImagesMock
      .mockResolvedValueOnce([
        { id: 'img-1', namespace: 'old-space' },
        { id: 'img-2', namespace: 'cf-default' },
      ])
      .mockResolvedValueOnce([
        { id: 'img-1', namespace: 'new-space-name' },
        { id: 'img-2', namespace: 'cf-default' },
      ]);
    listVideoAssetRecordsMock
      .mockResolvedValueOnce([
        { id: 'vid-1', namespace: 'old-space' },
      ])
      .mockResolvedValueOnce([
        { id: 'vid-1', namespace: 'new-space-name' },
      ]);
    listRegistryNamespaceDetailsMock
      .mockResolvedValueOnce([
        { name: 'old-space', description: 'Old assets' },
        { name: 'cf-default', description: 'Default namespace' },
      ])
      .mockResolvedValueOnce([
        { name: 'new-space-name', description: 'Old assets' },
        { name: 'cf-default', description: 'Default namespace' },
      ]);
    const request = new NextRequest('http://localhost/api/namespaces', {
      method: 'PATCH',
      body: JSON.stringify({ namespace: 'old-space', targetNamespace: 'new-space-name' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await PATCH(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(upsertRegistryNamespaceMock).toHaveBeenCalledWith('new-space-name', 'Old assets');
    expect(patchCloudflareImageMetadataMock).toHaveBeenCalledWith(
      'img-1',
      expect.any(Function),
      { requiredKeys: ['namespace'] }
    );
    expect(updateVideoAssetRecordMock).toHaveBeenCalledWith('vid-1', { namespace: 'new-space-name' });
    expect(renameRegistryNamespaceMock).toHaveBeenCalledWith('old-space', 'new-space-name');
    expect(payload).toEqual(expect.objectContaining({
      partialFailure: false,
      movedImageIds: ['img-1'],
      movedVideoIds: ['vid-1'],
      namespaces: ['cf-default', 'new-space-name'],
    }));
  });

  it('rejects namespace rename when the target already exists', async () => {
    listRegistryNamespaceDetailsMock.mockResolvedValueOnce([
      { name: 'old-space', description: '' },
      { name: 'taken-space', description: '' },
    ]);
    const request = new NextRequest('http://localhost/api/namespaces', {
      method: 'PATCH',
      body: JSON.stringify({ namespace: 'old-space', targetNamespace: 'taken-space' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await PATCH(request);
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error).toMatch(/already exists/i);
    expect(patchCloudflareImageMetadataMock).not.toHaveBeenCalled();
    expect(updateVideoAssetRecordMock).not.toHaveBeenCalled();
  });

  it('keeps both namespace registry entries when any rename move fails', async () => {
    getCachedImagesMock.mockResolvedValueOnce([
      { id: 'img-1', namespace: 'old-space' },
      { id: 'img-2', namespace: 'old-space' },
    ]);
    listVideoAssetRecordsMock.mockResolvedValueOnce([]);
    listRegistryNamespaceDetailsMock.mockResolvedValueOnce([
      { name: 'old-space', description: 'Old assets' },
      { name: 'cf-default', description: 'Default namespace' },
    ]);
    patchCloudflareImageMetadataMock
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('Cloudflare failed'));
    const request = new NextRequest('http://localhost/api/namespaces', {
      method: 'PATCH',
      body: JSON.stringify({ namespace: 'old-space', targetNamespace: 'new-space-name' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await PATCH(request);
    const payload = await response.json();

    expect(response.status).toBe(207);
    expect(payload.partialFailure).toBe(true);
    expect(payload.movedImageIds).toEqual(['img-1']);
    expect(payload.failures).toEqual([
      { id: 'img-2', assetType: 'image', error: 'Cloudflare failed' },
    ]);
    expect(upsertRegistryNamespaceMock).toHaveBeenCalledWith('new-space-name', 'Old assets');
    expect(renameRegistryNamespaceMock).not.toHaveBeenCalled();
  });

  it('keeps the namespace registered when any move fails', async () => {
    getCachedImagesMock.mockResolvedValueOnce([
      { id: 'img-1', namespace: 'old-space' },
      { id: 'img-2', namespace: 'old-space' },
    ]);
    listVideoAssetRecordsMock.mockResolvedValueOnce([]);
    patchCloudflareImageMetadataMock
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('Cloudflare failed'));
    const request = new NextRequest('http://localhost/api/namespaces', {
      method: 'DELETE',
      body: JSON.stringify({ namespace: 'old-space' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await DELETE(request);
    const payload = await response.json();

    expect(response.status).toBe(207);
    expect(payload.partialFailure).toBe(true);
    expect(payload.movedImageIds).toEqual(['img-1']);
    expect(payload.failures).toEqual([
      { id: 'img-2', assetType: 'image', error: 'Cloudflare failed' },
    ]);
    expect(removeRegistryNamespaceMock).not.toHaveBeenCalled();
  });
});
