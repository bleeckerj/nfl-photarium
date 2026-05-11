import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/namespaces/route';

const {
  listRegistryNamespaceDetailsMock,
  upsertRegistryNamespaceMock,
  getCachedImagesMock,
} = vi.hoisted(() => ({
  listRegistryNamespaceDetailsMock: vi.fn(),
  upsertRegistryNamespaceMock: vi.fn(),
  getCachedImagesMock: vi.fn(),
}));

vi.mock('@/server/namespaceRegistry', () => ({
  listRegistryNamespaceDetails: listRegistryNamespaceDetailsMock,
  upsertRegistryNamespace: upsertRegistryNamespaceMock,
}));

vi.mock('@/server/cloudflareImageCache', () => ({
  getCachedImages: getCachedImagesMock,
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
  });

  it('returns merged namespaces with no-store headers', async () => {
    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(payload).toEqual({
      namespaces: ['cf-default', 'discovered-space', 'new-space'],
      namespaceDetails: [
        { name: 'cf-default', description: 'Default namespace' },
        { name: 'discovered-space', description: '' },
        { name: 'new-space', description: '' },
      ],
    });
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
});
