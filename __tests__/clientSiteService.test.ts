import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientSiteService } from '@/features/client-sites/service';
import type { ClientSiteRecord } from '@/features/client-sites/types';
import type { ClientSiteStore } from '@/features/client-sites/storage/fileStore';
import type { ClientPageProjectRecord } from '@/features/client-pages/types';
import type { ClientPageProjectStore } from '@/features/client-pages/storage/fileStore';

class InMemoryClientSiteStore implements ClientSiteStore {
  constructor(private clientSites: ClientSiteRecord[] = []) {}

  async list(): Promise<ClientSiteRecord[]> {
    return [...this.clientSites];
  }

  async get(clientSiteId: string): Promise<ClientSiteRecord | null> {
    return this.clientSites.find((clientSite) => clientSite.id === clientSiteId) ?? null;
  }

  async writeClientSites(clientSites: ClientSiteRecord[]): Promise<void> {
    this.clientSites = [...clientSites];
  }
}

class InMemoryClientPageProjectStore implements ClientPageProjectStore {
  constructor(private projects: ClientPageProjectRecord[] = []) {}

  async list(): Promise<ClientPageProjectRecord[]> {
    return [...this.projects];
  }

  async get(projectId: string): Promise<ClientPageProjectRecord | null> {
    return this.projects.find((project) => project.id === projectId) ?? null;
  }

  async writeProjects(projects: ClientPageProjectRecord[]): Promise<void> {
    this.projects = [...projects];
  }
}

describe('ClientSiteService', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('creates client sites with derived worker metadata and runtime secrets', async () => {
    const registeredNamespaces: string[] = [];
    const service = new ClientSiteService(
      new InMemoryClientSiteStore(),
      new InMemoryClientPageProjectStore(),
      async (namespace) => {
        if (namespace) registeredNamespaces.push(namespace);
      }
    );

    const clientSite = await service.createClientSite({
      name: '  ACME North America  ',
    });

    expect(clientSite.name).toBe('ACME North America');
    expect(clientSite.slug).toBe('acme-north-america');
    expect(clientSite.deployment.workerName).toBe('photarium-client-acme-north-america');
    expect(clientSite.deployment.d1DatabaseName).toBe('photarium-client-acme-north-america');
    expect(clientSite.publishSecret).toHaveLength(48);
    expect(clientSite.runtimeSecrets.accessLinkHashSecret).toBeTruthy();
    expect(clientSite.runtimeSecrets.sessionSigningSecret).toBeTruthy();
    expect(registeredNamespaces).toEqual(['acme-north-america-a']);
  });

  it('derives a managed custom domain when the base domain is configured', async () => {
    vi.stubEnv('CLIENT_SITES_BASE_DOMAIN', 'clients.example.com');
    vi.stubEnv('CLIENT_SITES_ZONE_ID', 'zone-123');

    const service = new ClientSiteService(
      new InMemoryClientSiteStore(),
      new InMemoryClientPageProjectStore()
    );

    const clientSite = await service.createClientSite({
      name: 'And Sons',
    });

    expect(clientSite.deployment.customDomain).toBe('and-sons.clients.example.com');
    expect(clientSite.deployment.domainStatus).toBe('pending');
    expect(clientSite.deployment.publicBaseUrl).toBe('https://photarium-client-and-sons.workers.dev');
  });

  it('reports linked project counts per client site', async () => {
    const service = new ClientSiteService(
      new InMemoryClientSiteStore([
        {
          id: 'site-1',
          name: 'ACME',
          slug: 'acme',
          status: 'deployed',
          publishSecret: 'publish-secret',
          runtimeSecrets: {
            accessLinkHashSecret: 'access-secret',
            sessionSigningSecret: 'session-secret',
          },
          deployment: {
            workerName: 'photarium-client-acme',
            publicBaseUrl: 'https://photarium-client-acme.workers.dev',
          },
          createdAt: '2026-04-01T00:00:00.000Z',
          updatedAt: '2026-04-01T00:00:00.000Z',
        },
      ]),
      new InMemoryClientPageProjectStore([
        {
          id: 'project-1',
          title: 'Project One',
          clientSiteId: 'site-1',
          status: 'draft',
          expiresAt: null,
          selectedImageIds: [],
          sourceNamespaces: [],
          accessPolicy: { mode: 'secret-link', sessionTtlSeconds: 120 },
          visibleTagPolicy: { mode: 'prefix-filter', hiddenPrefixes: [], hiddenExact: [] },
          downloadPresetPolicy: { viewPresets: [], downloadPresets: [], allowedOutputFormats: ['jpg'] },
          createdAt: '2026-04-01T00:00:00.000Z',
          updatedAt: '2026-04-01T00:00:00.000Z',
        },
      ])
    );

    const clientSites = await service.listClientSites();
    expect(clientSites[0].linkedProjectCount).toBe(1);
  });

  it('builds root presentation data from active published linked projects', async () => {
    const store = new InMemoryClientSiteStore([
      {
        id: 'site-1',
        name: 'ACME',
        slug: 'acme',
        status: 'deployed',
        publishSecret: 'publish-secret',
        runtimeSecrets: {
          accessLinkHashSecret: 'access-secret',
          sessionSigningSecret: 'session-secret',
        },
        rootPresentation: { projects: [] },
        deployment: {
          workerName: 'photarium-client-acme',
          publicBaseUrl: 'https://photarium-client-acme.workers.dev',
        },
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-04-01T00:00:00.000Z',
      },
    ]);
    const service = new ClientSiteService(
      store,
      new InMemoryClientPageProjectStore([
        {
          id: 'project-older',
          title: 'Older Gallery',
          clientSiteId: 'site-1',
          status: 'published',
          expiresAt: null,
          selectedImageIds: ['img-1'],
          sourceNamespaces: [],
          accessPolicy: { mode: 'secret-link', sessionTtlSeconds: 120 },
          visibleTagPolicy: { mode: 'prefix-filter', hiddenPrefixes: [], hiddenExact: [] },
          downloadPresetPolicy: { viewPresets: [], downloadPresets: [], allowedOutputFormats: ['jpg'] },
          publicSlug: 'older-slug',
          accessKey: 'older-key',
          lastPublishedAt: '2026-04-02T00:00:00.000Z',
          createdAt: '2026-04-01T00:00:00.000Z',
          updatedAt: '2026-04-02T00:00:00.000Z',
        },
        {
          id: 'project-newer',
          title: 'Newer Gallery',
          clientSiteId: 'site-1',
          status: 'published',
          expiresAt: null,
          selectedImageIds: ['img-2'],
          sourceNamespaces: [],
          accessPolicy: { mode: 'secret-link', sessionTtlSeconds: 120 },
          visibleTagPolicy: { mode: 'prefix-filter', hiddenPrefixes: [], hiddenExact: [] },
          downloadPresetPolicy: { viewPresets: [], downloadPresets: [], allowedOutputFormats: ['jpg'] },
          publicSlug: 'newer-slug',
          accessKey: 'newer-key',
          lastPublishedAt: '2026-04-03T00:00:00.000Z',
          createdAt: '2026-04-01T00:00:00.000Z',
          updatedAt: '2026-04-03T00:00:00.000Z',
        },
        {
          id: 'project-shadow',
          title: 'Shadow Gallery',
          clientSiteId: 'site-1',
          status: 'shadow',
          expiresAt: null,
          selectedImageIds: ['img-3'],
          sourceNamespaces: [],
          accessPolicy: { mode: 'secret-link', sessionTtlSeconds: 120 },
          visibleTagPolicy: { mode: 'prefix-filter', hiddenPrefixes: [], hiddenExact: [] },
          downloadPresetPolicy: { viewPresets: [], downloadPresets: [], allowedOutputFormats: ['jpg'] },
          publicSlug: 'shadow-slug',
          accessKey: 'shadow-key',
          lastPublishedAt: '2026-04-04T00:00:00.000Z',
          createdAt: '2026-04-01T00:00:00.000Z',
          updatedAt: '2026-04-04T00:00:00.000Z',
        },
      ])
    );

    const updated = await service.syncRootPresentation('site-1');

    expect(updated.rootPresentation?.defaultProjectId).toBe('project-newer');
    expect(updated.rootPresentation?.defaultSharePath).toBe('/p/newer-slug?k=newer-key');
    expect(updated.rootPresentation?.projects.map((project) => project.projectId)).toEqual([
      'project-newer',
      'project-older',
    ]);
  });
});
