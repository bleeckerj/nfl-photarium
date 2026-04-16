import type { ClientSitePublishRequest, ClientSitePublishRequest as PublishRequestShape } from '@/features/client-sites-publishing/types';
import { publishClientSiteProject } from '@/features/client-sites-publishing/publisher';
import { buildPublishHeaders, isLocalPublishTarget } from '@/features/client-sites-publishing/publishAuth';
import type { ClientPageProjectRecord, ClientPagePublishResult } from './types';
import { buildClientPageShareUrl } from './utils/shareUrl';
import type { ClientPageProjectService } from './projectService';

const getRequiredEnv = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required to publish client pages.`);
  }
  return value;
};

const getTargetBaseUrl = (): string => getRequiredEnv('CLIENT_SITES_TARGET_BASE_URL');

const getConfiguredPublishSecret = (targetBaseUrl: string): string | undefined => {
  const configuredSecret =
    process.env.CLIENT_SITES_PUBLISH_SECRET?.trim() ||
    process.env.CLIENT_SITES_ADMIN_API_TOKEN?.trim();
  if (configuredSecret) return configuredSecret;
  if (isLocalPublishTarget(targetBaseUrl)) return undefined;
  throw new Error(
    'CLIENT_SITES_PUBLISH_SECRET is required when publishing to a non-local client-sites host.'
  );
};

const buildPublishRequest = (project: ClientPageProjectRecord): PublishRequestShape => {
  const targetBaseUrl = getTargetBaseUrl();
  return {
    targetBaseUrl,
    publishSecret: getConfiguredPublishSecret(targetBaseUrl),
    project: {
      remoteProjectId: project.remoteProjectId,
      publicSlug: project.publicSlug,
      title: project.title,
      expiresAt: project.expiresAt ?? null,
      sourceNamespaces: project.sourceNamespaces,
    },
    selection: {
      imageIds: project.selectedImageIds,
    },
    accessPolicy: project.accessPolicy,
    visibleTagPolicy: project.visibleTagPolicy,
    downloadPresetPolicy: project.downloadPresetPolicy,
  };
};

const getPublicBaseUrl = (): string =>
  process.env.CLIENT_SITES_PUBLIC_BASE_URL?.trim() ||
  getTargetBaseUrl();

const callLifecycleEndpoint = async (
  project: ClientPageProjectRecord,
  status: 'shadow' | 'archived'
): Promise<void> => {
  if (!project.remoteProjectId) return;

  const targetBaseUrl = getTargetBaseUrl().replace(/\/$/, '');
  const publishSecret = getConfiguredPublishSecret(targetBaseUrl);
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
  constructor(private readonly projectService: ClientPageProjectService) {}

  async publish(project: ClientPageProjectRecord): Promise<ClientPagePublishResult> {
    if (project.selectedImageIds.length === 0) {
      throw new Error('Select at least one image before publishing.');
    }

    const result = await publishClientSiteProject(buildPublishRequest(project) as ClientSitePublishRequest);

    const updatedProject = await this.projectService.updateStoredProject({
      ...project,
      status: 'published',
      remoteProjectId: result.project.id,
      publicSlug: result.project.publicSlug,
      accessKey: result.accessKey ?? project.accessKey,
      lastPublishedRevisionId: result.manifest.revision.projectRevisionId,
      lastPublishedAt: new Date().toISOString(),
    });

    return {
      project: updatedProject,
      shareUrl: buildClientPageShareUrl(
        getPublicBaseUrl(),
        updatedProject.publicSlug!,
        updatedProject.accessKey!
      ),
      manifestRevisionId: result.manifest.revision.projectRevisionId,
    };
  }

  async shadow(project: ClientPageProjectRecord): Promise<ClientPageProjectRecord> {
    await callLifecycleEndpoint(project, 'shadow');
    return this.projectService.updateStoredProject({
      ...project,
      status: 'shadow',
    });
  }

  async archive(project: ClientPageProjectRecord): Promise<ClientPageProjectRecord> {
    await callLifecycleEndpoint(project, 'archived');
    return this.projectService.updateStoredProject({
      ...project,
      status: 'archived',
    });
  }

  getShareUrl(project: ClientPageProjectRecord): string | null {
    if (!project.publicSlug || !project.accessKey) return null;
    return buildClientPageShareUrl(getPublicBaseUrl(), project.publicSlug, project.accessKey);
  }
}
