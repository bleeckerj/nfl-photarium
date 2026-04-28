'use client';

import type { CloudflareImage } from '@/components/gallery/types';
import type {
  ClientPageProjectListItem,
  ClientPageProjectRecord,
  ClientPagePublishResult,
  CreateClientPageProjectInput,
  UpdateClientPageProjectInput,
} from '../types';

export interface ClientSiteSummary {
  id: string;
  name: string;
  slug: string;
  status: 'draft' | 'deployed' | 'inactive' | 'deleted';
  linkedProjectCount?: number;
  deployment: {
    workerName: string;
    publicBaseUrl: string;
    customDomain?: string;
    lastDeployStatus?: 'idle' | 'success' | 'failed';
    lastDeployAt?: string;
    lastDeployMessage?: string;
  };
}

export interface ClientPageProjectResponse {
  project: ClientPageProjectRecord;
  shareUrl: string | null;
}

export interface ClientPageListResponse {
  projects: ClientPageProjectListItem[];
}

export interface ClientSiteListResponse {
  clientSites: ClientSiteSummary[];
}

const readJson = async <T>(response: Response): Promise<T> => {
  const payload = (await response.json().catch(() => null)) as T | { error?: string } | null;
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
        ? payload.error
        : 'Request failed.';
    throw new Error(message);
  }
  return payload as T;
};

const sendJson = async <T>(input: RequestInfo, init?: RequestInit): Promise<T> => {
  const response = await fetch(input, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  return readJson<T>(response);
};

export const clientPageApi = {
  listProjects: () => sendJson<ClientPageListResponse>('/api/client-pages'),
  createProject: (payload: CreateClientPageProjectInput) =>
    sendJson<ClientPageProjectResponse>('/api/client-pages', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getProject: (projectId: string) => sendJson<ClientPageProjectResponse>(`/api/client-pages/${projectId}`),
  updateProject: (projectId: string, payload: UpdateClientPageProjectInput) =>
    sendJson<ClientPageProjectResponse>(`/api/client-pages/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  replaceSelection: (projectId: string, selectedImageIds: string[]) =>
    sendJson<ClientPageProjectResponse>(`/api/client-pages/${projectId}/selection`, {
      method: 'POST',
      body: JSON.stringify({ selectedImageIds }),
    }),
  publishProject: (projectId: string) =>
    sendJson<ClientPagePublishResult>(`/api/client-pages/${projectId}/publish`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  shadowProject: (projectId: string) =>
    sendJson<ClientPageProjectResponse>(`/api/client-pages/${projectId}/shadow`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  archiveProject: (projectId: string) =>
    sendJson<ClientPageProjectResponse>(`/api/client-pages/${projectId}/archive`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  loadCatalogImages: async () => {
    const response = await fetch('/api/images?includeVectorMeta=1&namespace=__all__');
    const payload = await readJson<{ images?: CloudflareImage[] }>(response);
    return payload.images ?? [];
  },
  loadNamespaces: async () => {
    const response = await fetch('/api/namespaces', { cache: 'no-store' });
    const payload = await readJson<{ namespaces?: string[] }>(response);
    return Array.isArray(payload.namespaces) ? payload.namespaces : [];
  },
  listClientSites: async () => {
    const response = await fetch('/api/client-sites');
    const payload = await readJson<ClientSiteListResponse>(response);
    return payload.clientSites ?? [];
  },
  searchSemantically: async (query: string, namespace: string) => {
    const response = await fetch('/api/images/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'text',
        query,
        limit: 120,
        namespace: namespace === '__all__' ? null : namespace,
      }),
    });
    const payload = await readJson<{ results?: Array<{ imageId?: string; id?: string }> }>(response);
    return new Set(
      (payload.results ?? [])
        .map((result) => result.imageId ?? result.id)
        .filter((entry): entry is string => Boolean(entry))
    );
  },
};
