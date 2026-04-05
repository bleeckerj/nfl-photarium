import type { ClientPageProjectListItem, ClientPageProjectRecord } from '../types';
import { buildClientPageShareUrl } from '../utils/shareUrl';

const resolvePublicBaseUrl = (): string | undefined => {
  const explicitPublicBaseUrl = process.env.CLIENT_SITES_PUBLIC_BASE_URL?.trim();
  if (explicitPublicBaseUrl) return explicitPublicBaseUrl;
  const targetBaseUrl = process.env.CLIENT_SITES_TARGET_BASE_URL?.trim();
  return targetBaseUrl || undefined;
};

export const toClientPageProjectResponse = (project: ClientPageProjectRecord) => {
  const publicBaseUrl = resolvePublicBaseUrl();
  return {
    project,
    shareUrl:
      publicBaseUrl && project.publicSlug && project.accessKey
        ? buildClientPageShareUrl(publicBaseUrl, project.publicSlug, project.accessKey)
        : null,
  };
};

export const toClientPageListResponse = (projects: ClientPageProjectListItem[]) => ({
  projects,
});
