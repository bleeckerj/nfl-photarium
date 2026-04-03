import type { Context } from 'hono';
import { ProjectRepository } from '../../projects/repository';
import { ProjectAssetRepository } from '../../assets/repository';
import { ProjectAssetService } from '../../assets/service';
import { AssetDeliveryService } from '../../delivery/service';
import { ProjectAccessService } from '../../access/service';
import { withNoIndex } from '../../lib/http';

export const handleDownloadAsset = async (context: Context<{ Bindings: Env }>): Promise<Response> => {
  const publicAssetId = context.req.param('publicAssetId');
  const presetName = context.req.param('downloadPreset');
  const format = context.req.param('format');
  if (!publicAssetId || !presetName || !format) return new Response(null, { status: 404 });

  const assetService = new ProjectAssetService(new ProjectAssetRepository(context.env.DB));
  const asset = await assetService.findByPublicAssetId(publicAssetId);
  if (!asset) return new Response(null, { status: 404 });

  const projectRepository = new ProjectRepository(context.env.DB);
  const project = await projectRepository.findById(asset.projectId);
  if (!project) return new Response(null, { status: 404 });

  const accessService = new ProjectAccessService(
    context.env.ACCESS_LINK_HASH_SECRET,
    context.env.SESSION_SIGNING_SECRET
  );
  const hasSession = await accessService.hasValidProjectSession(context.req.raw, project);
  if (!hasSession) return new Response(null, { status: 404 });

  const deliveryService = new AssetDeliveryService(context.env.IMAGES_ACCOUNT_HASH);
  const response = await deliveryService.buildDownloadResponse(
    asset,
    project.downloadPresetPolicy,
    presetName,
    format
  );

  if (!response) return new Response(null, { status: 404 });
  return withNoIndex(response);
};
