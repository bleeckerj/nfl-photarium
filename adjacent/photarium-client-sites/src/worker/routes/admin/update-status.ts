import type { Context } from 'hono';
import { json, jsonError } from '../../lib/json';
import { isAuthorizedAdminRequest } from '../../access/admin-auth';
import { ProjectRepository } from '../../projects/repository';
import { ProjectService } from '../../projects/service';

export const handleUpdateStatus = async (context: Context<{ Bindings: Env }>): Promise<Response> => {
  if (!isAuthorizedAdminRequest(context.req.raw, context.env.ADMIN_API_TOKEN)) {
    return jsonError(401, 'Unauthorized');
  }

  const payload = await context.req.json().catch(() => null);
  if (!payload) return jsonError(400, 'Invalid JSON body');

  const repository = new ProjectRepository(context.env.DB);
  const service = new ProjectService(repository, context.env.ACCESS_LINK_HASH_SECRET);
  const change = service.parseStatusChange(payload);

  if (change.projectId !== context.req.param('id')) {
    return jsonError(409, 'Path project id does not match change project id');
  }

  const project = await repository.findById(change.projectId);
  if (!project) return jsonError(404, 'Project not found');

  await repository.updateStatus(change.projectId, change.status);
  return json({ ok: true, status: change.status });
};
