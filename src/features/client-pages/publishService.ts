import type { ClientSitePublishRequest, ClientSitePublishRequest as PublishRequestShape } from '@/features/client-sites-publishing/types';
import { publishClientSiteProject } from '@/features/client-sites-publishing/publisher';
import { buildPublishHeaders, isLocalPublishTarget } from '@/features/client-sites-publishing/publishAuth';
import type { ClientSiteService } from '@/features/client-sites/service';
import type { ClientSiteRecord } from '@/features/client-sites/types';
import { buildClientSiteBaseUrl, resolveClientSiteCustomDomain } from '@/features/client-sites/domain';
import { isLegacyWorkersDevUrl, resolveWorkersDevUrl } from '@/features/client-sites/workersDevUrl';
import type { ClientPageProjectRecord, ClientPagePublishResult } from './types';
import { buildClientPageShareUrl } from './utils/shareUrl';
import type { ClientPageProjectService } from './projectService';

const getConfiguredPublishSecret = (clientSite: ClientSiteRecord): string | undefined => {
  const configuredSecret = clientSite.publishSecret?.trim();
  const targetBaseUrl = clientSite.deployment.publicBaseUrl;
  if (configuredSecret) return configuredSecret;
  if (isLocalPublishTarget(targetBaseUrl)) return undefined;
  throw new Error(`Client site "${clientSite.name}" is missing a publish secret.`);
};

const buildPublishRequest = (project: ClientPageProjectRecord, clientSite: ClientSiteRecord): PublishRequestShape => {
  const targetBaseUrl = clientSite.deployment.publicBaseUrl;
  return {
    targetBaseUrl,
    publishSecret: getConfiguredPublishSecret(clientSite),
    project: {
      remoteProjectId: project.remoteProjectId,
      publicSlug: project.publicSlug,
      title: project.title,
      expiresAt: project.expiresAt ?? null,
      sourceNamespaces: project.sourceNamespaces,
    },
    selection: {
      assetIds: project.selectedImageIds,
    },
    accessPolicy: project.accessPolicy,
    visibleTagPolicy: project.visibleTagPolicy,
    downloadPresetPolicy: project.downloadPresetPolicy,
  };
};

const callLifecycleEndpoint = async (
  project: ClientPageProjectRecord,
  clientSite: ClientSiteRecord,
  status: 'shadow' | 'archived'
): Promise<void> => {
  if (!project.remoteProjectId) return;

  const targetBaseUrl = clientSite.deployment.publicBaseUrl.replace(/\/$/, '');
  const publishSecret = getConfiguredPublishSecret(clientSite);
  const response = await fetch(`${targetBaseUrl}/api/admin/projects/${project.remoteProjectId}/status`, {
    method: 'POST',
    headers: buildPublishHeaders(publishSecret),
    body: JSON.stringify({
      schemaVersion: '2026-04-01',
      projectId: project.remoteProjectId,
      status,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to update remote client-page status (${response.status}).`);
  }
};

export class ClientPagePublishService {
  constructor(
    private readonly projectService: ClientPageProjectService,
    private readonly clientSiteService: ClientSiteService
  ) {}

  private async requireClientSite(project: ClientPageProjectRecord): Promise<ClientSiteRecord> {
    if (!project.clientSiteId) {
      throw new Error('Assign this client page to a client site before publishing.');
    }
    let clientSite = await this.clientSiteService.getClientSite(project.clientSiteId);
    if (!clientSite) {
      throw new Error('Assigned client site could not be found.');
    }
    if (clientSite.status === 'deleted') {
      throw new Error('Assigned client site has been deleted.');
    }
    if (isLegacyWorkersDevUrl(clientSite.deployment.publicBaseUrl)) {
      const customDomain = resolveClientSiteCustomDomain(clientSite.slug, clientSite.deployment.customDomain);
      if (customDomain) {
        clientSite = await this.clientSiteService.updateStoredClientSite({
          ...clientSite,
          deployment: {
            ...clientSite.deployment,
            publicBaseUrl: buildClientSiteBaseUrl(customDomain),
            customDomain,
          },
        });
        return clientSite;
      }

      const correctedWorkersDevUrl = await resolveWorkersDevUrl(clientSite.deployment.workerName).catch(() => null);
      if (correctedWorkersDevUrl) {
        clientSite = await this.clientSiteService.updateStoredClientSite({
          ...clientSite,
          deployment: {
            ...clientSite.deployment,
            publicBaseUrl: correctedWorkersDevUrl,
            workersDevUrl: correctedWorkersDevUrl,
          },
        });
      }
    }
    return clientSite;
  }

  async publish(project: ClientPageProjectRecord): Promise<ClientPagePublishResult> {
    if (project.selectedImageIds.length === 0) {
      throw new Error('Select at least one asset before publishing.');
    }

    const clientSite = await this.requireClientSite(project);
    const result = await publishClientSiteProject(buildPublishRequest(project, clientSite) as ClientSitePublishRequest);

    const updatedProject = await this.projectService.updateStoredProject({
      ...project,
      status: 'published',
      remoteProjectId: result.project.id,
      publicSlug: result.project.publicSlug,
      accessKey: result.accessKey ?? project.accessKey,
      lastPublishedRevisionId: result.manifest.revision.projectRevisionId,
      lastPublishedAt: new Date().toISOString(),
    });
    await this.clientSiteService.syncRootPresentation(clientSite.id);

    return {
      project: updatedProject,
      shareUrl: buildClientPageShareUrl(
        clientSite.deployment.publicBaseUrl,
        updatedProject.publicSlug!,
        updatedProject.accessKey!
      ),
      manifestRevisionId: result.manifest.revision.projectRevisionId,
    };
  }

  async shadow(project: ClientPageProjectRecord): Promise<ClientPageProjectRecord> {
    const clientSite = await this.requireClientSite(project);
    await callLifecycleEndpoint(project, clientSite, 'shadow');
    const updatedProject = await this.projectService.updateStoredProject({
      ...project,
      status: 'shadow',
    });
    await this.clientSiteService.syncRootPresentation(clientSite.id);
    return updatedProject;
  }

  async archive(project: ClientPageProjectRecord): Promise<ClientPageProjectRecord> {
    const clientSite = await this.requireClientSite(project);
    await callLifecycleEndpoint(project, clientSite, 'archived');
    const updatedProject = await this.projectService.updateStoredProject({
      ...project,
      status: 'archived',
    });
    await this.clientSiteService.syncRootPresentation(clientSite.id);
    return updatedProject;
  }

  async getShareUrl(project: ClientPageProjectRecord): Promise<string | null> {
    if (!project.publicSlug || !project.accessKey) return null;
    const clientSite = await this.requireClientSite(project);
    return buildClientPageShareUrl(
      clientSite.deployment.publicBaseUrl,
      project.publicSlug,
      project.accessKey
    );
  }
}
