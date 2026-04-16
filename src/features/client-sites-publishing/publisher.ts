import { buildPublishedProjectManifest } from './manifestBuilder';
import type { ClientSitePublishRequest } from './types';
import {
  buildPublishHeaders,
  normalizePublishTargetBaseUrl,
  resolvePublishSecret,
} from './publishAuth';

interface RemoteProjectCreateResponse {
  project: {
    id: string;
    publicSlug: string;
    title: string;
    status: string;
    expiresAt: string | null;
  };
  accessKey: string;
}

export const publishClientSiteProject = async (request: ClientSitePublishRequest) => {
  const targetBaseUrl = normalizePublishTargetBaseUrl(request.targetBaseUrl);
  const publishSecret = resolvePublishSecret(request);
  let remoteProjectId = request.project.remoteProjectId;
  let publicSlug = request.project.publicSlug;
  let accessKey: string | undefined;

  if (!remoteProjectId || !publicSlug) {
    const createResponse = await fetch(`${targetBaseUrl}/api/admin/projects`, {
      method: 'POST',
      headers: buildPublishHeaders(publishSecret),
      body: JSON.stringify({
        title: request.project.title,
        expiresAt: request.project.expiresAt ?? null,
        accessPolicy: request.accessPolicy,
        visibleTagPolicy: request.visibleTagPolicy,
        downloadPresetPolicy: request.downloadPresetPolicy,
      }),
    });

    if (!createResponse.ok) {
      throw new Error(`Failed to create remote client-site project (${createResponse.status})`);
    }

    const created = (await createResponse.json()) as RemoteProjectCreateResponse;
    remoteProjectId = created.project.id;
    publicSlug = created.project.publicSlug;
    accessKey = created.accessKey;
  }

  const manifest = await buildPublishedProjectManifest({
    project: {
      id: remoteProjectId,
      publicSlug,
      title: request.project.title,
      status: 'published',
      expiresAt: request.project.expiresAt ?? null,
      sourceNamespaces: request.project.sourceNamespaces,
    },
    selection: request.selection,
    accessPolicy: request.accessPolicy,
    visibleTagPolicy: request.visibleTagPolicy,
    downloadPresetPolicy: request.downloadPresetPolicy,
  });

  const publishResponse = await fetch(`${targetBaseUrl}/api/admin/projects/${remoteProjectId}/publish`, {
    method: 'POST',
    headers: buildPublishHeaders(publishSecret),
    body: JSON.stringify(manifest),
  });

  if (!publishResponse.ok) {
    throw new Error(`Failed to publish remote client-site project (${publishResponse.status})`);
  }

  const publishResult = await publishResponse.json();
  return {
    project: {
      id: remoteProjectId,
      publicSlug,
      title: request.project.title,
      expiresAt: request.project.expiresAt ?? null,
    },
    accessKey,
    manifest,
    publishResult,
  };
};
