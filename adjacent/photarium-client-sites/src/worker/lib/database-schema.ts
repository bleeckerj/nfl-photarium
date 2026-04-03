/**
 * Ensures the local D1 schema exists before route handlers read or write state.
 */

const schemaStatements = [
  `
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      public_slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      access_key_hash TEXT NOT NULL,
      expires_at TEXT,
      access_policy_json TEXT NOT NULL,
      visible_tag_policy_json TEXT NOT NULL,
      download_preset_policy_json TEXT NOT NULL,
      current_revision_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS project_revisions (
      revision_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      manifest_version TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      source_namespaces_json TEXT NOT NULL,
      manifest_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS project_assets (
      public_asset_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      revision_id TEXT NOT NULL,
      source_image_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      display_name TEXT,
      description TEXT,
      visible_tags_json TEXT NOT NULL,
      source_tags_json TEXT NOT NULL,
      uploaded_at TEXT NOT NULL,
      aspect_ratio TEXT,
      width INTEGER,
      height INTEGER,
      is_canonical INTEGER NOT NULL,
      has_embedding INTEGER NOT NULL,
      cluster_id TEXT,
      cluster_label TEXT,
      preview_variant TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (revision_id) REFERENCES project_revisions(revision_id) ON DELETE CASCADE
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS shortlist_submissions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      client_session_id TEXT NOT NULL,
      selected_asset_ids_json TEXT NOT NULL,
      client_name TEXT,
      client_email TEXT,
      note TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `,
  'CREATE INDEX IF NOT EXISTS idx_projects_public_slug ON projects(public_slug)',
  'CREATE INDEX IF NOT EXISTS idx_project_assets_project_id ON project_assets(project_id)',
  'CREATE INDEX IF NOT EXISTS idx_project_assets_revision_id ON project_assets(revision_id)',
  'CREATE INDEX IF NOT EXISTS idx_shortlist_submissions_project_id ON shortlist_submissions(project_id)',
];

let ensureSchemaPromise: Promise<void> | null = null;

export const ensureDatabaseSchema = async (database: D1Database): Promise<void> => {
  if (!ensureSchemaPromise) {
    ensureSchemaPromise = (async () => {
      for (const statement of schemaStatements) {
        await database.prepare(statement).run();
      }
    })();
  }

  await ensureSchemaPromise;
};
