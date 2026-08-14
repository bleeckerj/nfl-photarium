import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { schemaMigrations } from './schema.js';

export function applySchemaMigrations(database: DatabaseSync): number {
  database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  const applied = new Set((database.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map((migration) => migration.version));
  for (const migration of schemaMigrations) {
    if (applied.has(migration.version)) continue;
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(migration.sql);
      database.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)').run(migration.version, migration.name, new Date().toISOString());
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
  return schemaMigrations.at(-1)?.version ?? 0;
}

export function currentSchemaVersion(database: DatabaseSync): number {
  const row = database.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number | null };
  return Number(row.version ?? 0);
}

export function openCatalogDatabase(databasePath: string): DatabaseSync {
  mkdirSync(dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  applySchemaMigrations(database);
  return database;
}

export function rebuildAssetSearchIndex(database: DatabaseSync, assetIds?: string[]): void {
  if (!assetIds) {
    database.exec('DELETE FROM assets_fts');
    database.exec(`
      INSERT INTO assets_fts(asset_id, filename, folder_path, keyword_text, caption, copyright, collection_text, annotation_text)
      SELECT a.id, a.filename, COALESCE(a.folder_path, ''),
        COALESCE((SELECT group_concat(k.name || ' ' || COALESCE(k.genealogy, ''), ' ') FROM asset_keywords ak JOIN keywords k ON k.id = ak.keyword_id WHERE ak.asset_id = a.id), ''),
        COALESCE(a.caption, ''), COALESCE(a.copyright, ''),
        COALESCE((SELECT group_concat(c.name, ' ') FROM asset_collections ac JOIN collections c ON c.id = ac.collection_id WHERE ac.asset_id = a.id), ''),
        COALESCE((SELECT note || ' ' || tags_json FROM annotations an WHERE an.asset_id = a.id), '')
      FROM assets a
    `);
    return;
  }

  const deleteStatement = database.prepare('DELETE FROM assets_fts WHERE asset_id = ?');
  const insertStatement = database.prepare(`
    INSERT INTO assets_fts(asset_id, filename, folder_path, keyword_text, caption, copyright, collection_text, annotation_text)
    SELECT a.id, a.filename, COALESCE(a.folder_path, ''),
      COALESCE((SELECT group_concat(k.name || ' ' || COALESCE(k.genealogy, ''), ' ') FROM asset_keywords ak JOIN keywords k ON k.id = ak.keyword_id WHERE ak.asset_id = a.id), ''),
      COALESCE(a.caption, ''), COALESCE(a.copyright, ''),
      COALESCE((SELECT group_concat(c.name, ' ') FROM asset_collections ac JOIN collections c ON c.id = ac.collection_id WHERE ac.asset_id = a.id), ''),
      COALESCE((SELECT note || ' ' || tags_json FROM annotations an WHERE an.asset_id = a.id), '')
    FROM assets a WHERE a.id = ?
  `);
  for (const assetId of assetIds) {
    deleteStatement.run(assetId);
    insertStatement.run(assetId);
  }
}
