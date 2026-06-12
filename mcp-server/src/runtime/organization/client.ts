import { apiRequest } from '../shared/api-client.js';
import { formatImageResult } from '../shared/image-result.js';
import type { ImageResult } from '../types.js';

export async function listFolders(namespace?: string): Promise<string[]> {
  const params = new URLSearchParams();
  if (namespace) params.set('namespace', namespace);
  const data = await apiRequest<{ folders: string[] }>(`/api/folders?${params}`);
  return data.folders;
}

export async function createFolder(name: string): Promise<{ success: boolean; name: string }> {
  return apiRequest<{ success: boolean; name: string }>('/api/folders', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function listNamespaces(): Promise<string[]> {
  const data = await apiRequest<{ namespaces: string[] }>('/api/namespaces');
  return data.namespaces;
}

export async function updateMetadata(
  imageId: string,
  updates: {
    folder?: string;
    tags?: string[];
    description?: string | null;
    displayName?: string | null;
    altTag?: string;
    originalUrl?: string | null;
    sourceUrl?: string | null;
    namespace?: string;
    parentId?: string;
    variationSort?: number;
    clearExif?: boolean;
  }
): Promise<ImageResult> {
  const data = await apiRequest<ImageResult>(`/api/images/${imageId}/update`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
  return formatImageResult(data);
}

export async function deleteImage(imageId: string): Promise<{ success: boolean }> {
  return apiRequest<{ success: boolean }>(`/api/images/${imageId}`, {
    method: 'DELETE',
  });
}

export async function getExtras(imageId: string): Promise<{ imageId: string; record: { description?: string; altText?: string } | null }> {
  return apiRequest(`/api/images/${imageId}/extras`);
}

export async function updateExtras(imageId: string, updates: { description?: string | null; altText?: string | null }): Promise<{ imageId: string; record: { description?: string; altText?: string } | null }> {
  return apiRequest(`/api/images/${imageId}/extras`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export async function rotateImage(imageId: string, options: { direction?: 'left' | 'right'; degrees?: number; auto?: boolean } = {}): Promise<{
  id: string;
  url: string;
  variants: string[];
  rotatedFromId: string;
  message?: string;
}> {
  return apiRequest(`/api/images/${imageId}/rotate`, {
    method: 'POST',
    body: JSON.stringify(options),
  });
}

export async function swapImageParent(imageId: string, options: { newParentId: string; concurrency?: number; dryRun?: boolean }): Promise<Record<string, unknown>> {
  return apiRequest(`/api/images/${imageId}/swap-parent`, {
    method: 'POST',
    body: JSON.stringify(options),
  });
}

export async function deleteImageFamily(imageId: string, options: { confirm?: string; dryRun?: boolean; concurrency?: number; async?: boolean } = {}): Promise<Record<string, unknown>> {
  return apiRequest(`/api/images/${imageId}/delete-family`, {
    method: 'POST',
    body: JSON.stringify(options),
  });
}

export async function getDeleteFamilyJob(jobId: string): Promise<Record<string, unknown>> {
  return apiRequest(`/api/jobs/delete-family/${jobId}`);
}
