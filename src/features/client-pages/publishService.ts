import type { ClientSitePublishRequest, ClientSitePublishRequest as PublishRequestShape } from '@/features/client-sites-publishing/types';
import { publishClientSiteProject } from '@/features/client-sites-publishing/publisher';
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

const buildPublishRequest = (project: ClientPageProjectRecord): PublishRequestShape => ({
  targetBaseUrl: getRequiredEnv('CLIENT_SITES_TARGET_BASE_URL'),
  adminApiToken: getRequiredEnv('CLIENT_SITES_ADMIN_API_TOKEN'),
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
});

const getPublicBaseUrl = (): string =>
  process.env.CLIENT_SITES_PUBLIC_BASE_URL?.trim() ||
  getRequiredEnv('CLIENT_SITES_TARGET_BASE_URL');

const callLifecycleEndpoint = async (
  project: ClientPageProjectRecord,
  status: 'shadow' | 'archived'
): Promise<void> => {
  if (!project.remoteProjectId) return;

  const targetBaseUrl = getRequiredEnv('CLIENT_SITES_TARGET_BASE_URL').replace(/\/$/, '');
  const adminApiToken = getRequiredEnv('CLIENT_SITES_ADMIN_API_TOKEN');
  const response = await fetch(`${targetBaseUrl}/api/admin/projects/${project.remoteProjectId}/status`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminApiToken}`,
      'Content-Type': 'application/json',
    },
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
