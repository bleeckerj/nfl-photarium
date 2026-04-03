import type { Context } from 'hono';
import { ProjectRepository } from '../../projects/repository';
import { ProjectAccessService } from '../../access/service';
import { diagnosticJsonError } from '../../dev/diagnostics';
import { isProjectPubliclyAccessible } from '../../projects/policy';
import type { ProjectRecord } from '../../projects/types';

export const createAccessService = (context: Context<{ Bindings: Env }>): ProjectAccessService =>
  new ProjectAccessService(
    context.env.ACCESS_LINK_HASH_SECRET,
    context.env.SESSION_SIGNING_SECRET
  );

export const loadProjectBySlug = async (context: Context<{ Bindings: Env }>) => {
  const publicSlug = context.req.param('slug');
  const repository = new ProjectRepository(context.env.DB);
  const project = publicSlug ? await repository.findBySlug(publicSlug) : null;
  return { repository, project };
};

type AccessibleProjectResult = { project: ProjectRecord } | { response: Response };

export const requireAccessibleProject = async (
  context: Context<{ Bindings: Env }>
): Promise<AccessibleProjectResult> => {
  const { project } = await loadProjectBySlug(context);
  if (!project) {
    return {
      response: diagnosticJsonError(
        context.env,
        404,
        'Not found',
        'project_not_found'
      ),
    };
  }
  if (!isProjectPubliclyAccessible(project, new Date().toISOString())) {
    return {
      response: diagnosticJsonError(
        context.env,
        404,
        'Not found',
        'project_inaccessible'
      ),
    };
  }
  return { project };
};
