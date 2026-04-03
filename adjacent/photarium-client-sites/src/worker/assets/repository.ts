import type { PublishedProjectAsset } from '../publishing-contract/types';
import type { ProjectAssetRecord } from './types';

interface ProjectAssetRow {
  public_asset_id: string;
  project_id: string;
  revision_id: string;
  source_image_id: string;
  filename: string;
  display_name: string | null;
  description: string | null;
  visible_tags_json: string;
  source_tags_json: string;
  uploaded_at: string;
  aspect_ratio: string | null;
  width: number | null;
  height: number | null;
  is_canonical: number;
  has_embedding: number;
  cluster_id: string | null;
  cluster_label: string | null;
  preview_variant: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

const mapAssetRow = (row: ProjectAssetRow): ProjectAssetRecord => ({
  publicAssetId: row.public_asset_id,
  projectId: row.project_id,
  revisionId: row.revision_id,
  sourceImageId: row.source_image_id,
  filename: row.filename,
  displayName: row.display_name ?? undefined,
  description: row.description ?? undefined,
  visibleTags: JSON.parse(row.visible_tags_json),
  sourceTags: JSON.parse(row.source_tags_json),
  uploadedAt: row.uploaded_at,
  aspectRatio: row.aspect_ratio ?? undefined,
  width: row.width ?? undefined,
  height: row.height ?? undefined,
  isCanonical: row.is_canonical === 1,
  hasEmbedding: row.has_embedding === 1,
  clusterId: row.cluster_id ?? undefined,
  clusterLabel: row.cluster_label ?? undefined,
  previewVariant: row.preview_variant ?? undefined,
  sortOrder: row.sort_order,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/**
 * D1 persistence for published asset snapshots.
 */
export class ProjectAssetRepository {
  constructor(private readonly database: D1Database) {}

  async replaceProjectAssets(
    projectId: string,
    revisionId: string,
    assets: ProjectAssetRecord[]
  ): Promise<void> {
    await this.database.prepare('DELETE FROM project_assets WHERE project_id = ?').bind(projectId).run();

    const statements = assets.map((asset) =>
      this.database
        .prepare(
          `
            INSERT INTO project_assets (
              public_asset_id, project_id, revision_id, source_image_id, filename,
              display_name, description, visible_tags_json, source_tags_json, uploaded_at,
              aspect_ratio, width, height, is_canonical, has_embedding,
              cluster_id, cluster_label, preview_variant, sort_order, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        )
        .bind(
          asset.publicAssetId,
          asset.projectId,
          revisionId,
          asset.sourceImageId,
          asset.filename,
          asset.displayName ?? null,
          asset.description ?? null,
          JSON.stringify(asset.visibleTags),
          JSON.stringify(asset.sourceTags),
          asset.uploadedAt,
          asset.aspectRatio ?? null,
          asset.width ?? null,
          asset.height ?? null,
          asset.isCanonical ? 1 : 0,
          asset.hasEmbedding ? 1 : 0,
          asset.clusterId ?? null,
          asset.clusterLabel ?? null,
          asset.previewVariant ?? null,
          asset.sortOrder,
          asset.createdAt,
          asset.updatedAt
        )
    );

    if (statements.length > 0) {
      await this.database.batch(statements);
    }
  }

  async upsertProjectAssets(projectId: string, revisionId: string, assets: ProjectAssetRecord[]): Promise<void> {
    const statements = assets.map((asset) =>
      this.database
        .prepare(
          `
            INSERT OR REPLACE INTO project_assets (
              public_asset_id, project_id, revision_id, source_image_id, filename,
              display_name, description, visible_tags_json, source_tags_json, uploaded_at,
              aspect_ratio, width, height, is_canonical, has_embedding,
              cluster_id, cluster_label, preview_variant, sort_order, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        )
        .bind(
          asset.publicAssetId,
          projectId,
          revisionId,
          asset.sourceImageId,
          asset.filename,
          asset.displayName ?? null,
          asset.description ?? null,
          JSON.stringify(asset.visibleTags),
          JSON.stringify(asset.sourceTags),
          asset.uploadedAt,
          asset.aspectRatio ?? null,
          asset.width ?? null,
          asset.height ?? null,
          asset.isCanonical ? 1 : 0,
          asset.hasEmbedding ? 1 : 0,
          asset.clusterId ?? null,
          asset.clusterLabel ?? null,
          asset.previewVariant ?? null,
          asset.sortOrder,
          asset.createdAt,
          asset.updatedAt
        )
    );

    if (statements.length > 0) {
      await this.database.batch(statements);
    }
  }

  async removeProjectAssets(projectId: string, publicAssetIds: string[]): Promise<void> {
    const statements = publicAssetIds.map((publicAssetId) =>
      this.database
        .prepare('DELETE FROM project_assets WHERE project_id = ? AND public_asset_id = ?')
        .bind(projectId, publicAssetId)
    );

    if (statements.length > 0) {
      await this.database.batch(statements);
    }
  }

  async listProjectAssets(projectId: string): Promise<ProjectAssetRecord[]> {
    const result = await this.database
      .prepare('SELECT * FROM project_assets WHERE project_id = ? ORDER BY sort_order ASC, uploaded_at DESC')
      .bind(projectId)
      .all<ProjectAssetRow>();

    return (result.results ?? []).map(mapAssetRow);
  }

  async findByPublicAssetId(publicAssetId: string): Promise<ProjectAssetRecord | null> {
    const row = await this.database
      .prepare('SELECT * FROM project_assets WHERE public_asset_id = ?')
      .bind(publicAssetId)
      .first<ProjectAssetRow>();

    return row ? mapAssetRow(row) : null;
  }

  static fromPublishedAsset(
    projectId: string,
    revisionId: string,
    asset: PublishedProjectAsset,
    visibleTags: string[]
  ): ProjectAssetRecord {
    const nowIso = new Date().toISOString();

    return {
      publicAssetId: asset.projectAssetId,
      projectId,
      revisionId,
      sourceImageId: asset.sourceImageId,
      filename: asset.filename,
      displayName: asset.displayName,
      description: asset.description,
      visibleTags,
      sourceTags: asset.sourceTags,
      uploadedAt: asset.uploadedAt,
      aspectRatio: asset.aspectRatio,
      width: asset.dimensions?.width,
      height: asset.dimensions?.height,
      isCanonical: asset.isCanonical,
      hasEmbedding: asset.hasEmbedding,
      clusterId: asset.clusterSeed?.id,
      clusterLabel: asset.clusterSeed?.label,
      previewVariant: asset.previewVariant,
      sortOrder: asset.sortOrder ?? 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  }
}
