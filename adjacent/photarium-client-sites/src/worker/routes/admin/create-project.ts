import type { Context } from 'hono';
import { jsonError, json } from '../../lib/json';
import { isAuthorizedAdminRequest } from '../../access/admin-auth';
import { ProjectRepository } from '../../projects/repository';
import { ProjectService } from '../../projects/service';

export const handleCreateProject = async (context: Context<{ Bindings: Env }>): Promise<Response> => {
  if (!isAuthorizedAdminRequest(context.req.raw, context.env)) {
    return jsonError(401, 'Unauthorized');
  }

  const payload = await context.req.json().catch(() => null);
  if (!payload) return jsonError(400, 'Invalid JSON body');

  const service = new ProjectService(
    new ProjectRepository(context.env.DB),
    context.env.ACCESS_LINK_HASH_SECRET
  );

  const { project, accessKey } = await service.createProject(payload);
  return json({
    project: {
      id: project.id,
      publicSlug: project.publicSlug,
      title: project.title,
      status: project.status,
      expiresAt: project.expiresAt ?? null,
    },
    accessKey,
  });
};
