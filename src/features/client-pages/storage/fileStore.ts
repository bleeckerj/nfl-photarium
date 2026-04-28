import fs from 'node:fs/promises';
import path from 'node:path';
import { getPhotariumRuntimeDataDir } from '@/server/runtimeDataDir';
import type { ClientPageProjectRecord, ClientPagesStorePayload } from '../types';

export interface ClientPageProjectStore {
  list(): Promise<ClientPageProjectRecord[]>;
  get(projectId: string): Promise<ClientPageProjectRecord | null>;
  writeProjects(projects: ClientPageProjectRecord[]): Promise<void>;
}

const STORE_PATH = path.join(getPhotariumRuntimeDataDir(), 'client-pages.json');

const defaultPayload = (): ClientPagesStorePayload => ({
  projects: [],
  updatedAt: new Date(0).toISOString(),
});

const sortProjects = (projects: ClientPageProjectRecord[]): ClientPageProjectRecord[] =>
  [...projects].sort((left, right) => {
    const rightTime = Date.parse(right.updatedAt) || 0;
    const leftTime = Date.parse(left.updatedAt) || 0;
    return rightTime - leftTime;
  });

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const parseProject = (value: unknown): ClientPageProjectRecord | null => {
  if (!isObject(value)) return null;
  if (typeof value.id !== 'string' || typeof value.title !== 'string') return null;
  if (typeof value.status !== 'string') return null;
  if (!Array.isArray(value.selectedImageIds) || !Array.isArray(value.sourceNamespaces)) return null;
  if (!isObject(value.accessPolicy) || !isObject(value.visibleTagPolicy) || !isObject(value.downloadPresetPolicy)) {
    return null;
  }
  if (typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') return null;

  return {
    id: value.id,
    title: value.title,
    clientName: typeof value.clientName === 'string' ? value.clientName : undefined,
    clientSiteId: typeof value.clientSiteId === 'string' ? value.clientSiteId : undefined,
    notes: typeof value.notes === 'string' ? value.notes : undefined,
    status: value.status as ClientPageProjectRecord['status'],
    expiresAt: typeof value.expiresAt === 'string' ? value.expiresAt : value.expiresAt === null ? null : undefined,
    selectedImageIds: value.selectedImageIds.filter((entry): entry is string => typeof entry === 'string'),
    sourceNamespaces: value.sourceNamespaces.filter((entry): entry is string => typeof entry === 'string'),
    accessPolicy: value.accessPolicy as unknown as ClientPageProjectRecord['accessPolicy'],
    visibleTagPolicy: value.visibleTagPolicy as unknown as ClientPageProjectRecord['visibleTagPolicy'],
    downloadPresetPolicy: value.downloadPresetPolicy as unknown as ClientPageProjectRecord['downloadPresetPolicy'],
    remoteProjectId: typeof value.remoteProjectId === 'string' ? value.remoteProjectId : undefined,
    publicSlug: typeof value.publicSlug === 'string' ? value.publicSlug : undefined,
    accessKey: typeof value.accessKey === 'string' ? value.accessKey : undefined,
    lastPublishedRevisionId:
      typeof value.lastPublishedRevisionId === 'string' ? value.lastPublishedRevisionId : undefined,
    lastPublishedAt: typeof value.lastPublishedAt === 'string' ? value.lastPublishedAt : undefined,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
};

const parsePayload = (value: unknown): ClientPagesStorePayload => {
  if (!isObject(value) || !Array.isArray(value.projects)) {
    return defaultPayload();
  }

  return {
    projects: sortProjects(value.projects.map(parseProject).filter((entry): entry is ClientPageProjectRecord => Boolean(entry))),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
  };
};

export class FileClientPageProjectStore implements ClientPageProjectStore {
  async list(): Promise<ClientPageProjectRecord[]> {
    const payload = await this.readPayload();
    return payload.projects;
  }

  async get(projectId: string): Promise<ClientPageProjectRecord | null> {
    const payload = await this.readPayload();
    return payload.projects.find((project) => project.id === projectId) ?? null;
  }

  async writeProjects(projects: ClientPageProjectRecord[]): Promise<void> {
    await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
    const payload: ClientPagesStorePayload = {
      projects: sortProjects(projects),
      updatedAt: new Date().toISOString(),
    };
    await fs.writeFile(STORE_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }

  private async readPayload(): Promise<ClientPagesStorePayload> {
    try {
      const raw = await fs.readFile(STORE_PATH, 'utf8');
      return parsePayload(JSON.parse(raw));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[client-pages] Failed to read project store', error);
      }
      return defaultPayload();
    }
  }
}
