import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientPagePublishService } from '@/features/client-pages/publishService';
import type { ClientPageProjectRecord } from '@/features/client-pages/types';
import type { ClientSiteRecord } from '@/features/client-sites/types';

class StubProjectService {
  public updatedProject: ClientPageProjectRecord | null = null;

  async updateStoredProject(project: ClientPageProjectRecord): Promise<ClientPageProjectRecord> {
    this.updatedProject = project;
    return project;
  }
}

class StubClientSiteService {
  public updatedClientSite: ClientSiteRecord | null = null;

  constructor(private readonly clientSite: ClientSiteRecord | null) {}

  async getClientSite(): Promise<ClientSiteRecord | null> {
    return this.clientSite;
  }

  async updateStoredClientSite(clientSite: ClientSiteRecord): Promise<ClientSiteRecord> {
    this.updatedClientSite = clientSite;
    return clientSite;
  }
}

const buildProject = (patch: Partial<ClientPageProjectRecord> = {}): ClientPageProjectRecord => ({
  id: 'project-1',
  title: 'Review set',
  status: 'published',
  expiresAt: null,
  selectedImageIds: ['img-1'],
  sourceNamespaces: ['campaign-a'],
  accessPolicy: { mode: 'secret-link', sessionTtlSeconds: 120 },
  visibleTagPolicy: { mode: 'prefix-filter', hiddenPrefixes: [], hiddenExact: [] },
  downloadPresetPolicy: {
    viewPresets: [{ name: 'grid', label: 'Grid', sourceVariant: 'public' }],
    downloadPresets: [{ name: 'web', label: 'Web', width: 1600, fit: 'scale-down', quality: 82 }],
    allowedOutputFormats: ['jpg', 'webp', 'png'],
  },
  publicSlug: 'opaque-slug',
  accessKey: 'secret-key',
  createdAt: '2026-04-01T00:00:00.000Z',
  updatedAt: '2026-04-01T00:00:00.000Z',
  ...patch,
});

const buildClientSite = (): ClientSiteRecord => ({
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
    d1DatabaseName: 'photarium-client-acme',
    d1DatabaseId: 'd1-id',
    publicBaseUrl: 'https://photarium-client-acme.workers.dev',
  },
  createdAt: '2026-04-01T00:00:00.000Z',
  updatedAt: '2026-04-01T00:00:00.000Z',
});

describe('ClientPagePublishService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds share URLs from the linked client site', async () => {
    const service = new ClientPagePublishService(
      new StubProjectService() as never,
      new StubClientSiteService(buildClientSite()) as never
    );

    await expect(service.getShareUrl(buildProject({ clientSiteId: 'site-1' }))).resolves.toBe(
      'https://photarium-client-acme.workers.dev/p/opaque-slug?k=secret-key'
    );
  });

  it('prefers a stored custom domain over a legacy workers.dev URL', async () => {
    const clientSiteService = new StubClientSiteService({
      ...buildClientSite(),
      deployment: {
        ...buildClientSite().deployment,
        customDomain: 'acme.clients.example.com',
      },
    });
    const service = new ClientPagePublishService(new StubProjectService() as never, clientSiteService as never);

    await expect(service.getShareUrl(buildProject({ clientSiteId: 'site-1' }))).resolves.toBe(
      'https://acme.clients.example.com/p/opaque-slug?k=secret-key'
    );
    expect(clientSiteService.updatedClientSite?.deployment.publicBaseUrl).toBe(
      'https://acme.clients.example.com'
    );
  });

  it('rejects legacy projects that are not linked to a client site', async () => {
    const service = new ClientPagePublishService(
      new StubProjectService() as never,
      new StubClientSiteService(buildClientSite()) as never
    );

    await expect(service.getShareUrl(buildProject())).rejects.toThrow(
      'Assign this client page to a client site before publishing.'
    );
  });
});
