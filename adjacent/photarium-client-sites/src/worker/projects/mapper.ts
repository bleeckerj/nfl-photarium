import type { ProjectRecord } from './types';

/**
 * Public-safe projection of a project record for the SPA bootstrap payload.
 */
export const mapProjectToPublicPayload = (project: ProjectRecord) => ({
  id: project.id,
  publicSlug: project.publicSlug,
  title: project.title,
  status: project.status,
  expiresAt: project.expiresAt ?? null,
  delivery: project.downloadPresetPolicy,
});
