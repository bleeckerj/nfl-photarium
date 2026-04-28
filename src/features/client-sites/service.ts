import { randomUUID } from 'node:crypto';
import type { ClientPageProjectStore } from '@/features/client-pages/storage/fileStore';
import type { ClientPageProjectRecord } from '@/features/client-pages/types';
import type {
  ClientSiteListItem,
  ClientSiteRecord,
  CreateClientSiteInput,
  ClientSiteRootProjectRecord,
  ClientSiteRootPresentationRecord,
  UpdateClientSiteInput,
} from './types';
import {
  buildClientSiteAssetNamespace,
  buildClientSiteD1Name,
  buildClientSiteWorkerName,
  createClientSitePublishSecret,
  createClientSiteRuntimeSecret,
  slugifyClientSiteName,
} from './naming';
import { resolveClientSiteCustomDomain } from './domain';
import type { ClientSiteStore } from './storage/fileStore';
import { upsertRegistryNamespace } from '@/server/namespaceRegistry';

const buildProjectSharePath = (project: Pick<ClientPageProjectRecord, 'publicSlug' | 'accessKey'>) =>
  `/p/${project.publicSlug}?k=${project.accessKey}`;

const sortRootProjects = (projects: ClientSiteRootProjectRecord[]) =>
  [...projects].sort((left, right) => {
    const rightPublishedAt = Date.parse(right.publishedAt) || 0;
    const leftPublishedAt = Date.parse(left.publishedAt) || 0;
    if (rightPublishedAt !== leftPublishedAt) {
      return rightPublishedAt - leftPublishedAt;
    }
    return left.title.localeCompare(right.title);
  });

const buildRootPresentation = (
  projects: ClientPageProjectRecord[],
  clientSiteId: string,
  nowIso = new Date().toISOString()
): ClientSiteRootPresentationRecord => {
  const activeProjects = sortRootProjects(
    projects
      .filter((project) =>
        project.clientSiteId === clientSiteId &&
        project.status === 'published' &&
        project.publicSlug &&
        project.accessKey &&
        (!project.expiresAt || project.expiresAt > nowIso)
      )
      .map((project) => ({
        projectId: project.id,
        title: project.title,
        publicSlug: project.publicSlug!,
        accessKey: project.accessKey!,
        sharePath: buildProjectSharePath(project as Required<Pick<ClientPageProjectRecord, 'publicSlug' | 'accessKey'>>),
        publishedAt: project.lastPublishedAt ?? project.updatedAt,
        expiresAt: project.expiresAt ?? null,
      }))
  );

  const [defaultProject] = activeProjects;
  return {
    defaultProjectId: defaultProject?.projectId,
    defaultPublicSlug: defaultProject?.publicSlug,
    defaultAccessKey: defaultProject?.accessKey,
    defaultSharePath: defaultProject?.sharePath,
    defaultPublishedAt: defaultProject?.publishedAt,
    projects: activeProjects,
  };
};

const cleanOptionalString = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const resolveStoredCustomDomain = (slug: string, customDomain?: string | null) => {
  const normalized = cleanOptionalString(customDomain);
  return resolveClientSiteCustomDomain(slug, normalized);
};

const assertClientSiteName = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Client site name is required.');
  }
  return trimmed;
};

export class ClientSiteService {
  constructor(
    private readonly store: ClientSiteStore,
    private readonly projectStore: ClientPageProjectStore,
    private readonly registerNamespace: (namespace?: string) => Promise<void> = upsertRegistryNamespace
  ) {}

  async listClientSites(): Promise<ClientSiteListItem[]> {
    const [clientSites, projects] = await Promise.all([this.store.list(), this.projectStore.list()]);
    return clientSites
      .filter((clientSite) => clientSite.status !== 'deleted')
      .map((clientSite) => ({
      ...clientSite,
      linkedProjectCount: projects.filter((project) => project.clientSiteId === clientSite.id).length,
      }));
  }

  async getClientSite(clientSiteId: string): Promise<ClientSiteRecord | null> {
    return this.store.get(clientSiteId);
  }

  async createClientSite(input: CreateClientSiteInput): Promise<ClientSiteRecord> {
    const clientSites = await this.store.list();
    const name = assertClientSiteName(input.name);
    const baseSlug = slugifyClientSiteName(input.slug ?? name);
    if (!baseSlug) {
      throw new Error('Client site slug could not be derived from the provided name.');
    }
    if (clientSites.some((entry) => entry.slug === baseSlug && entry.status !== 'deleted')) {
      throw new Error(`Client site slug "${baseSlug}" already exists.`);
    }

    const nowIso = new Date().toISOString();
    const workerName = buildClientSiteWorkerName(baseSlug);
    const customDomain = resolveStoredCustomDomain(baseSlug, input.customDomain);
    const clientSite: ClientSiteRecord = {
      id: randomUUID(),
      name,
      slug: baseSlug,
      status: 'draft',
      publishSecret: createClientSitePublishSecret(),
      runtimeSecrets: {
        accessLinkHashSecret: createClientSiteRuntimeSecret(),
        sessionSigningSecret: createClientSiteRuntimeSecret(),
      },
      branding: {},
      rootPresentation: {
        projects: [],
      },
      deployment: {
        workerName,
        d1DatabaseName: buildClientSiteD1Name(baseSlug),
        publicBaseUrl: `https://${workerName}.workers.dev`,
        customDomain,
        domainStatus: customDomain ? 'pending' : undefined,
        lastDeployStatus: 'idle',
      },
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    await this.store.writeClientSites([clientSite, ...clientSites]);
    await this.registerNamespace(buildClientSiteAssetNamespace(baseSlug));
    return clientSite;
  }

  async updateClientSite(clientSiteId: string, patch: UpdateClientSiteInput): Promise<ClientSiteRecord> {
    const clientSites = await this.store.list();
    const target = clientSites.find((entry) => entry.id === clientSiteId);
    if (!target) {
      throw new Error('Client site not found.');
    }

    const name = patch.name === undefined ? target.name : assertClientSiteName(patch.name);
    const explicitCustomDomain =
      patch.customDomain === undefined
        ? target.deployment.customDomain
        : cleanOptionalString(patch.customDomain);
    const resolvedCustomDomain = explicitCustomDomain
      ? resolveStoredCustomDomain(target.slug, explicitCustomDomain)
      : undefined;
    const nextDomainStatus =
      patch.customDomain === undefined
        ? target.deployment.domainStatus
        : resolvedCustomDomain
          ? target.deployment.domainStatus ?? 'pending'
          : 'detached';
    const updatedClientSite: ClientSiteRecord = {
      ...target,
      name,
      status: patch.status ?? target.status,
      deployment: {
        ...target.deployment,
        customDomain: resolvedCustomDomain,
        domainStatus: nextDomainStatus,
      },
      updatedAt: new Date().toISOString(),
    };

    await this.store.writeClientSites(
      clientSites.map((entry) => (entry.id === clientSiteId ? updatedClientSite : entry))
    );
    return updatedClientSite;
  }

  async updateStoredClientSite(clientSite: ClientSiteRecord): Promise<ClientSiteRecord> {
    const clientSites = await this.store.list();
    const hasExisting = clientSites.some((entry) => entry.id === clientSite.id);
    if (!hasExisting) {
      throw new Error('Client site not found.');
    }

    const nextClientSite = {
      ...clientSite,
      updatedAt: new Date().toISOString(),
    };
    await this.store.writeClientSites(
      clientSites.map((entry) => (entry.id === clientSite.id ? nextClientSite : entry))
    );
    return nextClientSite;
  }

  async syncRootPresentation(clientSiteId: string): Promise<ClientSiteRecord> {
    const [clientSites, projects] = await Promise.all([this.store.list(), this.projectStore.list()]);
    const target = clientSites.find((entry) => entry.id === clientSiteId);
    if (!target) {
      throw new Error('Client site not found.');
    }

    const nextClientSite: ClientSiteRecord = {
      ...target,
      rootPresentation: buildRootPresentation(projects, clientSiteId),
      updatedAt: new Date().toISOString(),
    };

    await this.store.writeClientSites(
      clientSites.map((entry) => (entry.id === clientSiteId ? nextClientSite : entry))
    );
    return nextClientSite;
  }
}
