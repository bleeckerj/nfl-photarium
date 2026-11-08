import { listImageDeleteFamily, type CatalogAsset } from '@/server/assetCatalog';
import { setAssetParentDirectlyWithAssets } from '@/server/assetParentService';
import { sortFamilyMembers } from '@/utils/familyOrder';

export type ImageDeletePlan = {
  parentId: string;
  newParent: { id: string; filename: string } | null;
  childIds: string[];
  signature: string;
};

export async function loadImageDeletePlan(parentId: string): Promise<{ plan: ImageDeletePlan; assets: CatalogAsset[] }> {
  const assets = await listImageDeleteFamily(parentId);
  const children = sortFamilyMembers(assets.filter((asset) => asset.parentId === parentId));
  const candidate = children.find((asset) => asset.assetType === 'image');
  const newParent = candidate ? { id: candidate.id, filename: candidate.filename } : null;
  const childIds = children.map((child) => child.id);
  return {
    assets,
    plan: { parentId, newParent, childIds, signature: JSON.stringify([newParent?.id ?? null, childIds]) },
  };
}

export class ImageDeleteFamilyUpdateError extends Error {
  constructor(public failedId: string, public rollbackFailedIds: string[], cause: unknown) {
    super(`Could not update variant ${failedId}: ${cause instanceof Error ? cause.message : String(cause)}. Parent was not deleted.${rollbackFailedIds.length ? ` Could not restore: ${rollbackFailedIds.join(', ')}.` : ' Previous links were restored.'}`);
  }
}

export async function applyImageDeletePlan(plan: ImageDeletePlan, assets: CatalogAsset[]): Promise<void> {
  const promotedId = plan.newParent?.id ?? '';
  const orderedIds = promotedId
    ? [promotedId, ...plan.childIds.filter((id) => id !== promotedId)]
    : plan.childIds;
  const updated: string[] = [];
  for (const id of orderedIds) {
    try {
      await setAssetParentDirectlyWithAssets(id, id === promotedId ? '' : promotedId, assets);
      updated.push(id);
    } catch (error) {
      const rollbackFailedIds: string[] = [];
      for (const updatedId of [id, ...updated.reverse()]) {
        try {
          await setAssetParentDirectlyWithAssets(updatedId, plan.parentId, assets);
        } catch {
          rollbackFailedIds.push(updatedId);
        }
      }
      throw new ImageDeleteFamilyUpdateError(id, rollbackFailedIds, error);
    }
  }
}
