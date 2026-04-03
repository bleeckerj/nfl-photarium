import type { ProjectRecord } from './types';
import type { PublishedProjectManifest, ProjectLifecycleStatus } from '../publishing-contract/types';

interface ProjectRow {
  id: string;
  public_slug: string;
  title: string;
  status: ProjectLifecycleStatus;
  access_key_hash: string;
  expires_at: string | null;
  access_policy_json: string;
  visible_tag_policy_json: string;
  download_preset_policy_json: string;
  current_revision_id: string | null;
  created_at: string;
  updated_at: string;
}

const parseProjectRow = (row: ProjectRow): ProjectRecord => ({
  id: row.id,
  publicSlug: row.public_slug,
  title: row.title,
  status: row.status,
  accessKeyHash: row.access_key_hash,
  expiresAt: row.expires_at,
  accessPolicy: JSON.parse(row.access_policy_json),
  visibleTagPolicy: JSON.parse(row.visible_tag_policy_json),
  downloadPresetPolicy: JSON.parse(row.download_preset_policy_json),
  currentRevisionId: row.current_revision_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/**
 * D1 persistence for project metadata and revision snapshots.
 */
export class ProjectRepository {
  constructor(private readonly database: D1Database) {}

  async findById(projectId: string): Promise<ProjectRecord | null> {
    const row = await this.database
      .prepare('SELECT * FROM projects WHERE id = ?')
      .bind(projectId)
      .first<ProjectRow>();

    return row ? parseProjectRow(row) : null;
  }

  async findBySlug(publicSlug: string): Promise<ProjectRecord | null> {
    const row = await this.database
      .prepare('SELECT * FROM projects WHERE public_slug = ?')
      .bind(publicSlug)
      .first<ProjectRow>();

    return row ? parseProjectRow(row) : null;
  }

  async insert(project: ProjectRecord): Promise<void> {
    await this.database
      .prepare(
        `
          INSERT INTO projects (
            id, public_slug, title, status, access_key_hash, expires_at,
            access_policy_json, visible_tag_policy_json, download_preset_policy_json,
            current_revision_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .bind(
        project.id,
        project.publicSlug,
        project.title,
        project.status,
        project.accessKeyHash,
        project.expiresAt ?? null,
        JSON.stringify(project.accessPolicy),
        JSON.stringify(project.visibleTagPolicy),
        JSON.stringify(project.downloadPresetPolicy),
        project.currentRevisionId ?? null,
        project.createdAt,
        project.updatedAt
      )
      .run();
  }

  async applyManifest(manifest: PublishedProjectManifest): Promise<void> {
    const nowIso = new Date().toISOString();
    await this.database
      .prepare(
        `
          UPDATE projects
          SET title = ?, status = ?, expires_at = ?, access_policy_json = ?, visible_tag_policy_json = ?,
              download_preset_policy_json = ?, current_revision_id = ?, updated_at = ?
          WHERE id = ?
        `
      )
      .bind(
        manifest.project.title,
        manifest.project.status,
        manifest.project.expiresAt ?? null,
        JSON.stringify(manifest.project.accessPolicy),
        JSON.stringify(manifest.project.visibleTagPolicy),
        JSON.stringify(manifest.project.downloadPresetPolicy),
        manifest.revision.projectRevisionId,
        nowIso,
        manifest.project.id
      )
      .run();
  }

  async storeRevision(manifest: PublishedProjectManifest): Promise<void> {
    await this.database
      .prepare(
        `
          INSERT OR REPLACE INTO project_revisions (
            revision_id, project_id, manifest_version, generated_at, source_namespaces_json,
            manifest_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `
      )
      .bind(
        manifest.revision.projectRevisionId,
        manifest.project.id,
        manifest.schemaVersion,
        manifest.revision.generatedAt,
        JSON.stringify(manifest.revision.sourceNamespaces),
        JSON.stringify(manifest),
        new Date().toISOString()
      )
      .run();
  }

  async updateStatus(projectId: string, status: ProjectLifecycleStatus): Promise<void> {
    await this.database
      .prepare('UPDATE projects SET status = ?, updated_at = ? WHERE id = ?')
      .bind(status, new Date().toISOString(), projectId)
      .run();
  }
}
