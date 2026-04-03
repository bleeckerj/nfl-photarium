import type { ProjectRecord } from './types';

/**
 * Centralized lifecycle policy for public delivery.
 */
export const isProjectExpired = (project: ProjectRecord, nowIso: string): boolean => {
  if (!project.expiresAt) return false;
  return project.expiresAt <= nowIso;
};

export const isProjectPubliclyAccessible = (project: ProjectRecord, nowIso: string): boolean =>
  project.status === 'published' && !isProjectExpired(project, nowIso);
