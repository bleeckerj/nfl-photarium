import type { ClientPageProjectListItem, ClientPageProjectRecord } from '../types';
import type { ClientPagePublishService } from '../publishService';

export const toClientPageProjectResponse = async (
  project: ClientPageProjectRecord,
  publishService: ClientPagePublishService
) => ({
  project,
  shareUrl: await publishService.getShareUrl(project).catch(() => null),
});

export const toClientPageListResponse = (projects: ClientPageProjectListItem[]) => ({
  projects,
});
