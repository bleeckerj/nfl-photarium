import type { Context } from 'hono';
import { json, jsonError } from '../../lib/json';
import { withNoIndex } from '../../lib/http';
import { ProjectAssetRepository } from '../../assets/repository';
import { ProjectAssetService } from '../../assets/service';
import { ShortlistRepository } from '../../shortlists/repository';
import { ShortlistService } from '../../shortlists/service';
import { createAccessService, requireAccessibleProject } from './helpers';

export const handleSubmitShortlist = async (context: Context<{ Bindings: Env }>): Promise<Response> => {
  const projectState = await requireAccessibleProject(context);
  if ('response' in projectState) return projectState.response;

  const accessService = createAccessService(context);
  const hasSession = await accessService.hasValidProjectSession(context.req.raw, projectState.project);
  if (!hasSession) return jsonError(404, 'Not found');

  const payload = await context.req.json().catch(() => null);
  if (!payload) return jsonError(400, 'Invalid JSON body');

  const shortlistService = new ShortlistService(new ShortlistRepository(context.env.DB));
  const submission = shortlistService.parseSubmission(payload);

  const assetService = new ProjectAssetService(new ProjectAssetRepository(context.env.DB));
  const assets = await assetService.listProjectAssets(projectState.project.id);
  const assetIdSet = new Set(assets.map((asset) => asset.publicAssetId));
  const hasForeignAsset = submission.selectedAssetIds.some((assetId) => !assetIdSet.has(assetId));
  if (hasForeignAsset) return jsonError(400, 'Shortlist contains assets outside the project');

  const record = await shortlistService.saveSubmission(projectState.project.id, submission);
  return withNoIndex(json({ ok: true, shortlistId: record.id }));
};
