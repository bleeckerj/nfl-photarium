import type { Context } from 'hono';
import { json } from '../../lib/json';
import { diagnosticJsonError } from '../../dev/diagnostics';
import { withNoIndex } from '../../lib/http';
import { ProjectAssetRepository } from '../../assets/repository';
import { ProjectAssetService } from '../../assets/service';
import { mapAssetToPublicPayload } from '../../assets/mapper';
import { createAccessService, requireAccessibleProject } from './helpers';

export const handleProjectAssets = async (context: Context<{ Bindings: Env }>): Promise<Response> => {
  const projectState = await requireAccessibleProject(context);
  if ('response' in projectState) return projectState.response;

  const accessService = createAccessService(context);
  const hasSession = await accessService.hasValidProjectSession(context.req.raw, projectState.project);
  if (!hasSession) {
    return diagnosticJsonError(
      context.env,
      404,
      'Not found',
      'session_missing_or_invalid'
    );
  }

  const assetService = new ProjectAssetService(new ProjectAssetRepository(context.env.DB));
  const assets = await assetService.listProjectAssets(projectState.project.id);

  return withNoIndex(
    json({
      assets: assets.map(mapAssetToPublicPayload),
    })
  );
};
