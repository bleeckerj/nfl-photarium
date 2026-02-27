import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/folders/route';
import { DELETE, PATCH } from '@/app/api/folders/[name]/route';

const {
  fetchCloudflareImagesMock,
  updateImageFolderMock,
  listStoredFoldersMock,
  addFolderMock,
  renameFolderMock,
  removeFolderMock,
} = vi.hoisted(() => ({
  fetchCloudflareImagesMock: vi.fn(),
  updateImageFolderMock: vi.fn(),
  listStoredFoldersMock: vi.fn(),
  addFolderMock: vi.fn(),
  renameFolderMock: vi.fn(),
  removeFolderMock: vi.fn(),
}));

vi.mock('@/utils/cloudflareClient', () => ({
  fetchCloudflareImages: fetchCloudflareImagesMock,
  updateImageFolder: updateImageFolderMock,
}));

vi.mock('@/utils/folderStore', async () => {
  const actual = await vi.importActual<typeof import('@/utils/folderStore')>('@/utils/folderStore');
  return {
    ...actual,
    listStoredFolders: listStoredFoldersMock,
    addFolder: addFolderMock,
    renameFolder: renameFolderMock,
    removeFolder: removeFolderMock,
  };
});

const createGetRequest = (url: string) => new NextRequest(new Request(url));

const createJsonRequest = (url: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown) =>
  new NextRequest(
    new Request(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );

describe('folders API routes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    fetchCloudflareImagesMock.mockResolvedValue([]);
    listStoredFoldersMock.mockResolvedValue([]);
    addFolderMock.mockResolvedValue(undefined);
    renameFolderMock.mockResolvedValue(undefined);
    removeFolderMock.mockResolvedValue(undefined);
    updateImageFolderMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('GET lists merged derived + stored folders within namespace', async () => {
    fetchCloudflareImagesMock.mockResolvedValue([
      { id: '1', folder: 'derived', namespace: 'ns-a' },
      { id: '2', folder: 'other', namespace: 'ns-b' },
      { id: '3', folder: '', namespace: 'ns-a' },
    ]);
    listStoredFoldersMock.mockResolvedValue(['stored']);

    const response = await GET(createGetRequest('http://localhost/api/folders?namespace=ns-a'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.folders).toEqual(['derived', 'stored']);
    expect(listStoredFoldersMock).toHaveBeenCalledWith('ns-a');
  });

  it('POST blocks creation in all-namespaces mode', async () => {
    const response = await POST(
      createJsonRequest('http://localhost/api/folders?namespace=__all__', 'POST', { name: 'campaigns' })
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('specific namespace');
    expect(addFolderMock).not.toHaveBeenCalled();
  });

  it('POST creates folder for the selected namespace', async () => {
    const response = await POST(
      createJsonRequest('http://localhost/api/folders?namespace=ns-a', 'POST', { name: 'campaigns' })
    );

    expect(response.status).toBe(200);
    expect(addFolderMock).toHaveBeenCalledWith('campaigns', 'ns-a');
  });

  it('PATCH blocks rename in all-namespaces mode', async () => {
    const response = await PATCH(
      createJsonRequest(
        'http://localhost/api/folders/campaigns?namespace=__all__',
        'PATCH',
        { newName: 'ads' }
      ),
      { params: Promise.resolve({ name: 'campaigns' }) }
    );

    expect(response.status).toBe(400);
    expect(renameFolderMock).not.toHaveBeenCalled();
  });

  it('PATCH renames only in selected namespace and updates matching images', async () => {
    fetchCloudflareImagesMock.mockResolvedValue([
      { id: '1', folder: 'campaigns', namespace: 'ns-a' },
      { id: '2', folder: 'campaigns', namespace: 'ns-b' },
      { id: '3', folder: 'other', namespace: 'ns-a' },
    ]);

    const response = await PATCH(
      createJsonRequest(
        'http://localhost/api/folders/campaigns?namespace=ns-a',
        'PATCH',
        { newName: 'ads' }
      ),
      { params: Promise.resolve({ name: 'campaigns' }) }
    );

    expect(response.status).toBe(200);
    expect(renameFolderMock).toHaveBeenCalledWith('campaigns', 'ads', 'ns-a');
    expect(updateImageFolderMock).toHaveBeenCalledTimes(1);
    expect(updateImageFolderMock).toHaveBeenCalledWith('1', 'ads');
  });

  it('DELETE deletes only in selected namespace and clears matching images', async () => {
    fetchCloudflareImagesMock.mockResolvedValue([
      { id: '1', folder: 'campaigns', namespace: 'ns-a' },
      { id: '2', folder: 'campaigns', namespace: 'ns-b' },
    ]);

    const response = await DELETE(
      createJsonRequest(
        'http://localhost/api/folders/campaigns?namespace=ns-a',
        'DELETE'
      ),
      { params: Promise.resolve({ name: 'campaigns' }) }
    );

    expect(response.status).toBe(200);
    expect(removeFolderMock).toHaveBeenCalledWith('campaigns', 'ns-a');
    expect(updateImageFolderMock).toHaveBeenCalledTimes(1);
    expect(updateImageFolderMock).toHaveBeenCalledWith('1', undefined);
  });
});
