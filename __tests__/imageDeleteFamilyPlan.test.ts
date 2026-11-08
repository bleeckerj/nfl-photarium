import { beforeEach, describe, expect, it, vi } from 'vitest';

const { list, assign } = vi.hoisted(() => ({ list: vi.fn(), assign: vi.fn() }));
vi.mock('@/server/assetCatalog', () => ({ listImageDeleteFamily: list }));
vi.mock('@/server/assetParentService', () => ({ setAssetParentDirectlyWithAssets: assign }));

import { applyImageDeletePlan, loadImageDeletePlan } from '@/server/imageDeleteFamilyPlan';

const assets = [
  { id: 'root', assetType: 'image', filename: 'root.jpg', uploaded: '2024-01-01' },
  { id: 'later', assetType: 'image', filename: 'later.jpg', uploaded: '2024-01-02', parentId: 'root', variationSort: 2 },
  { id: 'video', assetType: 'video', filename: 'video.mp4', uploaded: '2024-01-01', parentId: 'root', variationSort: 0 },
  { id: 'first', assetType: 'image', filename: 'first.jpg', uploaded: '2024-01-03', parentId: 'root', variationSort: 1 },
] as const;

describe('single-image deletion family plan', () => {
  beforeEach(() => { vi.resetAllMocks(); list.mockResolvedValue(assets); assign.mockResolvedValue({}); });

  it('promotes the first image in displayed order and moves all other children', async () => {
    const { plan, assets: catalog } = await loadImageDeletePlan('root');
    expect(plan.newParent?.id).toBe('first');
    expect(plan.childIds).toEqual(['video', 'first', 'later']);
    expect(list).toHaveBeenCalledWith('root');
    await applyImageDeletePlan(plan, catalog);
    expect(assign.mock.calls.map(([id, parent]) => [id, parent])).toEqual([
      ['first', ''], ['video', 'first'], ['later', 'first'],
    ]);
  });

  it('detaches children if the family contains only videos', async () => {
    list.mockResolvedValue(assets.filter((asset) => asset.id === 'root' || asset.id === 'video'));
    const { plan, assets: catalog } = await loadImageDeletePlan('root');
    expect(plan.newParent).toBeNull();
    await applyImageDeletePlan(plan, catalog);
    expect(assign).toHaveBeenCalledWith('video', '', catalog);
  });

  it('attempts to restore affected links if reassignment fails', async () => {
    const { plan, assets: catalog } = await loadImageDeletePlan('root');
    assign.mockRejectedValueOnce(new Error('unavailable'));
    await expect(applyImageDeletePlan(plan, catalog)).rejects.toThrow('Parent was not deleted');
    expect(assign.mock.calls.map(([id, parent]) => [id, parent])).toEqual([['first', ''], ['first', 'root']]);
  });

  it('reports failed restoration after a partial update', async () => {
    const { plan, assets: catalog } = await loadImageDeletePlan('root');
    assign.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('update failed'))
      .mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('restore failed'));
    await expect(applyImageDeletePlan(plan, catalog)).rejects.toMatchObject({ failedId: 'video', rollbackFailedIds: ['first'] });
  });
});
