import type { Context } from 'hono';
import { json, jsonError } from '../../lib/json';
import { isAuthorizedAdminRequest } from '../../access/admin-auth';
import { ProjectRepository } from '../../projects/repository';
import { ProjectService } from '../../projects/service';
import { ProjectAssetRepository } from '../../assets/repository';
import { ProjectAssetService } from '../../assets/service';
import { logInfo } from '../../observability/logger';

export const handlePublishProject = async (context: Context<{ Bindings: Env }>): Promise<Response> => {
  if (!isAuthorizedAdminRequest(context.req.raw, context.env.ADMIN_API_TOKEN)) {
    return jsonError(401, 'Unauthorized');
  }

  const payload = await context.req.json().catch(() => null);
  if (!payload) return jsonError(400, 'Invalid JSON body');

  const projectRepository = new ProjectRepository(context.env.DB);
  const projectService = new ProjectService(projectRepository, context.env.ACCESS_LINK_HASH_SECRET);
  const assetService = new ProjectAssetService(new ProjectAssetRepository(context.env.DB));

  const manifest = projectService.parseManifest(payload);
  if (manifest.project.id !== context.req.param('id')) {
    return jsonError(409, 'Path project id does not match manifest project id');
  }

  const existingProject = await projectRepository.findById(manifest.project.id);
  if (!existingProject) return jsonError(404, 'Project not found');

  await projectRepository.storeRevision(manifest);
  await projectRepository.applyManifest(manifest);
  const storedAssets = await assetService.applyManifest(manifest);

  logInfo('project.publish', {
    projectId: manifest.project.id,
    revisionId: manifest.revision.projectRevisionId,
    assetCount: storedAssets.length,
  });

  return json({
    ok: true,
    projectId: manifest.project.id,
    revisionId: manifest.revision.projectRevisionId,
    assetCount: storedAssets.length,
  });
};
