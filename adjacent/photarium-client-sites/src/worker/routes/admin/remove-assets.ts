import type { Context } from 'hono';
import { z } from 'zod';
import { json, jsonError } from '../../lib/json';
import { isAuthorizedAdminRequest } from '../../access/admin-auth';
import { ProjectAssetRepository } from '../../assets/repository';
import { ProjectAssetService } from '../../assets/service';

const removeAssetsSchema = z.object({
  publicAssetIds: z.array(z.string().min(1)).min(1),
});

export const handleRemoveAssets = async (context: Context<{ Bindings: Env }>): Promise<Response> => {
  const projectId = context.req.param('id');
  if (!projectId) return jsonError(400, 'Project id is required');

  if (!isAuthorizedAdminRequest(context.req.raw, context.env)) {
    return jsonError(401, 'Unauthorized');
  }

  const payload = await context.req.json().catch(() => null);
  if (!payload) return jsonError(400, 'Invalid JSON body');

  const parsed = removeAssetsSchema.safeParse(payload);
  if (!parsed.success) return jsonError(400, 'Invalid remove-assets payload');

  const assetService = new ProjectAssetService(new ProjectAssetRepository(context.env.DB));
  await assetService.removeAssets(projectId, parsed.data.publicAssetIds);
  return json({ ok: true, assetCount: parsed.data.publicAssetIds.length });
};
