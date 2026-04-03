import type { ProjectRecord } from '../projects/types';
import { isProjectPubliclyAccessible } from '../projects/policy';
import { buildSessionCookie, clearSessionCookie, readSessionCookie } from './cookie';
import { verifyAccessKey } from './token';
import type { ProjectSessionPayload } from './types';

/**
 * Public access orchestration for secret-link projects.
 */
export class ProjectAccessService {
  constructor(
    private readonly hashSecret: string,
    private readonly sessionSigningSecret: string
  ) {}

  async validateSecretLink(project: ProjectRecord, rawKey: string): Promise<boolean> {
    return verifyAccessKey(rawKey, project.accessKeyHash, this.hashSecret);
  }

  async issueSessionCookie(request: Request, project: ProjectRecord): Promise<string> {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const expiresAtEpochSeconds = nowSeconds + project.accessPolicy.sessionTtlSeconds;
    const payload: ProjectSessionPayload = {
      projectId: project.id,
      publicSlug: project.publicSlug,
      revisionId: project.currentRevisionId,
      expiresAtEpochSeconds,
    };

    return buildSessionCookie(payload, this.sessionSigningSecret, this.shouldUseSecureCookies(request));
  }

  async readSession(request: Request): Promise<ProjectSessionPayload | null> {
    const payload = await readSessionCookie(request, this.sessionSigningSecret);
    if (!payload) return null;
    if (payload.expiresAtEpochSeconds <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  }

  clearSessionCookie(request: Request): string {
    return clearSessionCookie(this.shouldUseSecureCookies(request));
  }

  hasValidProjectSession(request: Request, project: ProjectRecord): Promise<boolean> {
    return this.readSession(request).then((session) => {
      if (!session) return false;
      if (session.projectId !== project.id) return false;
      if (session.publicSlug !== project.publicSlug) return false;
      return isProjectPubliclyAccessible(project, new Date().toISOString());
    });
  }

  private shouldUseSecureCookies(request: Request): boolean {
    return new URL(request.url).protocol === 'https:';
  }
}
