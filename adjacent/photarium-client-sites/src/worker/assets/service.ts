import { publishedProjectDeltaSchema } from '../publishing-contract/schema';
import type { PublishedProjectDelta, PublishedProjectManifest, VisibleTagPolicy } from '../publishing-contract/types';
import { ProjectAssetRepository } from './repository';
import type { ProjectAssetRecord } from './types';
import { resolveVisibleTags } from './tag-policy';

/**
 * Published asset orchestration and tag sanitization.
 */
export class ProjectAssetService {
  constructor(private readonly repository: ProjectAssetRepository) {}

  async applyManifest(manifest: PublishedProjectManifest): Promise<ProjectAssetRecord[]> {
    const assets = manifest.assets.map((asset) =>
      ProjectAssetRepository.fromPublishedAsset(
        manifest.project.id,
        manifest.revision.projectRevisionId,
        asset,
        resolveVisibleTags(asset, manifest.project.visibleTagPolicy)
      )
    );

    await this.repository.replaceProjectAssets(
      manifest.project.id,
      manifest.revision.projectRevisionId,
      assets
    );

    return assets;
  }

  parseDelta(input: unknown): PublishedProjectDelta {
    return publishedProjectDeltaSchema.parse(input);
  }

  async addAssets(
    projectId: string,
    revisionId: string,
    assets: PublishedProjectDelta['assets'],
    tagPolicy: VisibleTagPolicy
  ): Promise<void> {
    const preparedAssets = assets.map((asset) =>
      ProjectAssetRepository.fromPublishedAsset(
        projectId,
        revisionId,
        asset,
        resolveVisibleTags(asset, tagPolicy)
      )
    );

    await this.repository.upsertProjectAssets(projectId, revisionId, preparedAssets);
  }

  async removeAssets(projectId: string, publicAssetIds: string[]): Promise<void> {
    await this.repository.removeProjectAssets(projectId, publicAssetIds);
  }

  async listProjectAssets(projectId: string): Promise<ProjectAssetRecord[]> {
    return this.repository.listProjectAssets(projectId);
  }

  async findByPublicAssetId(publicAssetId: string): Promise<ProjectAssetRecord | null> {
    return this.repository.findByPublicAssetId(publicAssetId);
  }
}
