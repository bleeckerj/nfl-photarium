import type { Context } from 'hono';
import { json, jsonError } from '../../lib/json';
import { isAuthorizedAdminRequest } from '../../access/admin-auth';
import { ProjectRepository } from '../../projects/repository';
import { ProjectAssetRepository } from '../../assets/repository';
import { ProjectAssetService } from '../../assets/service';

export const handleAddAssets = async (context: Context<{ Bindings: Env }>): Promise<Response> => {
  if (!isAuthorizedAdminRequest(context.req.raw, context.env)) {
    return jsonError(401, 'Unauthorized');
  }

  const payload = await context.req.json().catch(() => null);
  if (!payload) return jsonError(400, 'Invalid JSON body');

  const projectRepository = new ProjectRepository(context.env.DB);
  const assetService = new ProjectAssetService(new ProjectAssetRepository(context.env.DB));
  const delta = assetService.parseDelta(payload);

  if (delta.projectId !== context.req.param('id')) {
    return jsonError(409, 'Path project id does not match delta project id');
  }

  const project = await projectRepository.findById(delta.projectId);
  if (!project) return jsonError(404, 'Project not found');

  await assetService.addAssets(project.id, delta.projectRevisionId, delta.assets, project.visibleTagPolicy);
  return json({ ok: true, assetCount: delta.assets.length });
};
