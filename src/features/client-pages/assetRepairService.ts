import { getCachedImages } from '@/server/cloudflareImageCache';
import {
  enrichAssetsForPublishing,
  getMissingPublishMetadataReasons,
} from '@/server/assetMetadataEnrichment';
import { listVideoAssetRecordsWithSync, type VideoAssetRecord } from '@/server/videoCatalogStorage';
import type { CachedCloudflareImage } from '@/server/cloudflareImageCache';
import type { ClientPageAssetIssue, ClientPageProjectRecord } from './types';
import type { ClientPageProjectService } from './projectService';

const isVideo = (asset: CachedCloudflareImage | VideoAssetRecord): asset is VideoAssetRecord =>
  'assetType' in asset && asset.assetType === 'video';

export class ClientPageAssetRepairService {
  constructor(private readonly projectService: ClientPageProjectService) {}

  async inspect(project: ClientPageProjectRecord): Promise<ClientPageAssetIssue[]> {
    const [images, videos] = await Promise.all([
      getCachedImages(false),
      listVideoAssetRecordsWithSync(),
    ]);
    const imageMap = new Map(images.map((image) => [image.id, image]));
    const videoMap = new Map(videos.map((video) => [video.id, video]));
    const enriched = await enrichAssetsForPublishing(project.selectedImageIds);

    return project.selectedImageIds.flatMap<ClientPageAssetIssue>((id) => {
      const source = imageMap.get(id) ?? videoMap.get(id);
      if (!source) {
        return [{ id, assetType: 'unknown' as const, filename: id, missing: ['asset unavailable'] }];
      }
      const asset = isVideo(source)
        ? enriched.videos.get(id) ?? source
        : enriched.images.get(id) ?? source;
      const missing = getMissingPublishMetadataReasons(asset);
      return missing.length
        ? [{
            id,
            assetType: isVideo(asset) ? ('video' as const) : ('image' as const),
            filename: asset.filename,
            missing,
          }]
        : [];
    });
  }

  async removeIssues(
    project: ClientPageProjectRecord,
    issues: ClientPageAssetIssue[]
  ): Promise<{ project: ClientPageProjectRecord; removedAssets: ClientPageAssetIssue[] }> {
    const currentIssues = await this.inspect(project);
    const issueIds = new Set(currentIssues.map((issue) => issue.id));
    const removedAssets = currentIssues.filter((issue) => issues.some((requested) => requested.id === issue.id));
    const nextSelection = project.selectedImageIds.filter((id) => !issueIds.has(id));
    const updatedProject = await this.projectService.replaceSelection(project.id, {
      selectedImageIds: nextSelection,
    });
    return { project: updatedProject, removedAssets };
  }
}
