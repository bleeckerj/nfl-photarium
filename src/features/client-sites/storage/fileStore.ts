import fs from 'node:fs/promises';
import path from 'node:path';
import { getPhotariumRuntimeDataDir } from '@/server/runtimeDataDir';
import type {
  ClientSiteBrandingRecord,
  ClientSiteRecord,
  ClientSiteRootPresentationRecord,
  ClientSitesStorePayload,
} from '../types';

export interface ClientSiteStore {
  list(): Promise<ClientSiteRecord[]>;
  get(clientSiteId: string): Promise<ClientSiteRecord | null>;
  writeClientSites(clientSites: ClientSiteRecord[]): Promise<void>;
}

const STORE_PATH = path.join(getPhotariumRuntimeDataDir(), 'client-sites.json');

const defaultPayload = (): ClientSitesStorePayload => ({
  clientSites: [],
  updatedAt: new Date(0).toISOString(),
});

const sortClientSites = (clientSites: ClientSiteRecord[]): ClientSiteRecord[] =>
  [...clientSites].sort((left, right) => {
    const rightTime = Date.parse(right.updatedAt) || 0;
    const leftTime = Date.parse(left.updatedAt) || 0;
    return rightTime - leftTime;
  });

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const parseRootPresentation = (value: unknown): ClientSiteRootPresentationRecord | undefined => {
  if (!isObject(value) || !Array.isArray(value.projects)) {
    return undefined;
  }

  const projects = value.projects
    .filter(isObject)
    .map((project) => ({
      projectId: typeof project.projectId === 'string' ? project.projectId : '',
      title: typeof project.title === 'string' ? project.title : '',
      publicSlug: typeof project.publicSlug === 'string' ? project.publicSlug : '',
      accessKey: typeof project.accessKey === 'string' ? project.accessKey : '',
      sharePath: typeof project.sharePath === 'string' ? project.sharePath : '',
      publishedAt: typeof project.publishedAt === 'string' ? project.publishedAt : '',
      expiresAt: typeof project.expiresAt === 'string' ? project.expiresAt : null,
    }))
    .filter((project) =>
      project.projectId &&
      project.title &&
      project.publicSlug &&
      project.accessKey &&
      project.sharePath &&
      project.publishedAt
    );

  return {
    defaultProjectId: typeof value.defaultProjectId === 'string' ? value.defaultProjectId : undefined,
    defaultPublicSlug: typeof value.defaultPublicSlug === 'string' ? value.defaultPublicSlug : undefined,
    defaultAccessKey: typeof value.defaultAccessKey === 'string' ? value.defaultAccessKey : undefined,
    defaultSharePath: typeof value.defaultSharePath === 'string' ? value.defaultSharePath : undefined,
    defaultPublishedAt: typeof value.defaultPublishedAt === 'string' ? value.defaultPublishedAt : undefined,
    projects,
  };
};

const parseBranding = (value: unknown): ClientSiteBrandingRecord | undefined => {
  if (!isObject(value)) return undefined;

  const faviconUrl = typeof value.faviconUrl === 'string' ? value.faviconUrl : undefined;
  const logoUrl = typeof value.logoUrl === 'string' ? value.logoUrl : undefined;
  const logoAlt = typeof value.logoAlt === 'string' ? value.logoAlt : undefined;

  if (!faviconUrl && !logoUrl && !logoAlt) return undefined;

  return {
    faviconUrl,
    logoUrl,
    logoAlt,
  };
};

const parseClientSite = (value: unknown): ClientSiteRecord | null => {
  if (!isObject(value)) return null;
  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.slug !== 'string' ||
    typeof value.status !== 'string' ||
    typeof value.publishSecret !== 'string' ||
    !isObject(value.runtimeSecrets) ||
    !isObject(value.deployment) ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    return null;
  }

  const runtimeSecrets = value.runtimeSecrets;
  if (
    typeof runtimeSecrets.accessLinkHashSecret !== 'string' ||
    typeof runtimeSecrets.sessionSigningSecret !== 'string'
  ) {
    return null;
  }

  const deployment = value.deployment;
  if (
    typeof deployment.workerName !== 'string' ||
    typeof deployment.publicBaseUrl !== 'string'
  ) {
    return null;
  }

  return {
    id: value.id,
    name: value.name,
    slug: value.slug,
    status: value.status as ClientSiteRecord['status'],
    publishSecret: value.publishSecret,
    runtimeSecrets: {
      accessLinkHashSecret: runtimeSecrets.accessLinkHashSecret,
      sessionSigningSecret: runtimeSecrets.sessionSigningSecret,
    },
    branding: parseBranding(value.branding),
    rootPresentation: parseRootPresentation(value.rootPresentation),
    deployment: {
      workerName: deployment.workerName,
      d1DatabaseName: typeof deployment.d1DatabaseName === 'string' ? deployment.d1DatabaseName : undefined,
      d1DatabaseId: typeof deployment.d1DatabaseId === 'string' ? deployment.d1DatabaseId : undefined,
      publicBaseUrl: deployment.publicBaseUrl,
      workersDevUrl: typeof deployment.workersDevUrl === 'string' ? deployment.workersDevUrl : undefined,
      customDomain: typeof deployment.customDomain === 'string' ? deployment.customDomain : undefined,
      domainStatus:
        typeof deployment.domainStatus === 'string'
          ? (deployment.domainStatus as ClientSiteRecord['deployment']['domainStatus'])
          : undefined,
      domainLastCheckedAt:
        typeof deployment.domainLastCheckedAt === 'string' ? deployment.domainLastCheckedAt : undefined,
      lastDeployStatus:
        typeof deployment.lastDeployStatus === 'string'
          ? (deployment.lastDeployStatus as ClientSiteRecord['deployment']['lastDeployStatus'])
          : undefined,
      lastDeployAt: typeof deployment.lastDeployAt === 'string' ? deployment.lastDeployAt : undefined,
      lastDeployMessage:
        typeof deployment.lastDeployMessage === 'string' ? deployment.lastDeployMessage : undefined,
    },
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    deletedAt: typeof value.deletedAt === 'string' ? value.deletedAt : undefined,
  };
};

const parsePayload = (value: unknown): ClientSitesStorePayload => {
  if (!isObject(value) || !Array.isArray(value.clientSites)) {
    return defaultPayload();
  }

  return {
    clientSites: sortClientSites(
      value.clientSites.map(parseClientSite).filter((entry): entry is ClientSiteRecord => Boolean(entry))
    ),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
  };
};

export class FileClientSiteStore implements ClientSiteStore {
  async list(): Promise<ClientSiteRecord[]> {
    const payload = await this.readPayload();
    return payload.clientSites;
  }

  async get(clientSiteId: string): Promise<ClientSiteRecord | null> {
    const payload = await this.readPayload();
    return payload.clientSites.find((clientSite) => clientSite.id === clientSiteId) ?? null;
  }

  async writeClientSites(clientSites: ClientSiteRecord[]): Promise<void> {
    await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
    const payload: ClientSitesStorePayload = {
      clientSites: sortClientSites(clientSites),
      updatedAt: new Date().toISOString(),
    };
    await fs.writeFile(STORE_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }

  private async readPayload(): Promise<ClientSitesStorePayload> {
    try {
      const raw = await fs.readFile(STORE_PATH, 'utf8');
      return parsePayload(JSON.parse(raw));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[client-sites] Failed to read site store', error);
      }
      return defaultPayload();
    }
  }
}
