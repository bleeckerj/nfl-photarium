/**
 * Stateless session payload stored in a signed cookie.
 */
export interface ProjectSessionPayload {
  projectId: string;
  publicSlug: string;
  revisionId?: string | null;
  expiresAtEpochSeconds: number;
}

