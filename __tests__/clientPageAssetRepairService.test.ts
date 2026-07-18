import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientPageAssetRepairService } from '@/features/client-pages/assetRepairService';
import type { ClientPageProjectRecord } from '@/features/client-pages/types';

const {
  getCachedImagesMock,
  listVideoAssetRecordsWithSyncMock,
  enrichAssetsForPublishingMock,
} = vi.hoisted(() => ({
  getCachedImagesMock: vi.fn(),
  listVideoAssetRecordsWithSyncMock: vi.fn(),
  enrichAssetsForPublishingMock: vi.fn(),
}));

vi.mock('@/server/cloudflareImageCache', () => ({
  getCachedImages: getCachedImagesMock,
}));
vi.mock('@/server/videoCatalogStorage', () => ({
  listVideoAssetRecordsWithSync: listVideoAssetRecordsWithSyncMock,
}));
vi.mock('@/server/assetMetadataEnrichment', () => ({
  enrichAssetsForPublishing: enrichAssetsForPublishingMock,
  getMissingPublishMetadataReasons: (asset: { assetType?: string; fileSizeBytes?: number; durationSeconds?: number; width?: number; height?: number; aspectRatio?: string; size?: number; dimensions?: { width: number; height: number } }) => {
    if (asset.assetType === 'video') {
      return asset.fileSizeBytes && asset.durationSeconds && (asset.aspectRatio || (asset.width && asset.height))
        ? []
        : ['size'];
    }
    return asset.size && (asset.aspectRatio || (asset.dimensions?.width && asset.dimensions.height)) ? [] : ['size'];
  },
}));

const project: ClientPageProjectRecord = {
  id: 'project-1',
  title: 'Review',
  status: 'draft',
  selectedImageIds: ['video-1', 'missing-1', 'image-1'],
  sourceNamespaces: [],
  accessPolicy: { mode: 'secret-link', sessionTtlSeconds: 120 },
  visibleTagPolicy: { mode: 'prefix-filter', hiddenPrefixes: [], hiddenExact: [] },
  downloadPresetPolicy: { viewPresets: [], downloadPresets: [], allowedOutputFormats: [] },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('ClientPageAssetRepairService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCachedImagesMock.mockResolvedValue([
      { id: 'image-1', filename: 'image.jpg', size: 100, aspectRatio: '1:1', dimensions: { width: 1, height: 1 } },
    ]);
    listVideoAssetRecordsWithSyncMock.mockResolvedValue([
      { id: 'video-1', assetType: 'video', filename: 'broken.mp4', fileSizeBytes: undefined },
    ]);
    enrichAssetsForPublishingMock.mockResolvedValue({
      images: new Map(),
      videos: new Map(),
    });
  });

  it('reports missing catalog assets and incomplete metadata', async () => {
    const service = new ClientPageAssetRepairService({ replaceSelection: vi.fn() } as never);

    await expect(service.inspect(project)).resolves.toEqual([
      { id: 'video-1', assetType: 'video', filename: 'broken.mp4', missing: ['size'] },
      { id: 'missing-1', assetType: 'unknown', filename: 'missing-1', missing: ['asset unavailable'] },
    ]);
  });

  it('removes only issues still present during the confirmed cleanup', async () => {
    const replaceSelection = vi.fn().mockResolvedValue({ ...project, selectedImageIds: ['image-1'] });
    const service = new ClientPageAssetRepairService({ replaceSelection } as never);

    const result = await service.removeIssues(project, await service.inspect(project));

    expect(replaceSelection).toHaveBeenCalledWith('project-1', { selectedImageIds: ['image-1'] });
    expect(result.removedAssets).toHaveLength(2);
  });
});
