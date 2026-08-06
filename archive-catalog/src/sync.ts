import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { basename } from 'node:path';
import { catalogKey, discoverCatalogs, parseLightroomCatalog, type DiscoveredCatalog } from './lightroom.js';
import { rebuildAssetSearchIndex } from './db.js';
import type { CatalogSummary } from './types.js';

export interface SyncOptions {
  sourceRoot: string;
  database: DatabaseSync;
  hashFiles?: boolean;
  catalogPaths?: string[];
  allowLockedCatalog?: boolean;
}

export interface SyncResult {
  sourceRoot: string;
  catalogs: number;
  assets: number;
  availableAssets: number;
  warnings: string[];
}

async function hashFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk: Buffer) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function refreshCatalogRow(database: DatabaseSync, path: string, size: number, mtime: number, warning: string | null): string {
  const id = catalogKey(path);
  database.prepare(`
    INSERT INTO catalogs(id, path, name, size, mtime, status, warning, last_synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      path = excluded.path, name = excluded.name, size = excluded.size, mtime = excluded.mtime,
      status = excluded.status, warning = excluded.warning, last_synced_at = excluded.last_synced_at
  `).run(id, path, basename(path), size, mtime, warning ? 'warning' : 'ready', warning, new Date().toISOString());
  return id;
}

async function writeCatalog(database: DatabaseSync, catalog: DiscoveredCatalog, sourceRoot: string, hashFiles: boolean): Promise<{ assets: number; availableAssets: number; warning: string | null }> {
  const parsed = await parseLightroomCatalog(catalog, sourceRoot);
  const id = refreshCatalogRow(database, catalog.path, catalog.size, catalog.mtime, parsed.warning);
  const oldAssets = database.prepare('SELECT id FROM assets WHERE catalog_id = ?').all(id) as Array<{ id: string }>;
  const oldAnnotations = database.prepare(`SELECT an.asset_id, an.note, an.tags_json, an.shortlist, an.updated_at FROM annotations an JOIN assets a ON a.id = an.asset_id WHERE a.catalog_id = ?`).all(id) as Array<{ asset_id: string; note: string | null; tags_json: string; shortlist: number; updated_at: string }>;
  const oldPreviews = database.prepare(`SELECT p.asset_id, p.kind, p.path, p.mime_type, p.width, p.height, p.source_mtime, p.created_at FROM previews p JOIN assets a ON a.id = p.asset_id WHERE a.catalog_id = ?`).all(id) as Array<{ asset_id: string; kind: string; path: string; mime_type: string; width: number | null; height: number | null; source_mtime: number | null; created_at: string }>;
  for (const asset of oldAssets) database.prepare('DELETE FROM assets_fts WHERE asset_id = ?').run(asset.id);
  database.prepare('DELETE FROM assets WHERE catalog_id = ?').run(id);
  database.prepare('DELETE FROM keywords WHERE catalog_id = ?').run(id);
  database.prepare('DELETE FROM collections WHERE catalog_id = ?').run(id);

  const insertAsset = database.prepare(`
    INSERT INTO assets(
      id, catalog_id, catalog_image_id, file_id, filename, extension, file_format, capture_time,
      original_capture_time, rating, pick, color_labels, width, height, copy_name, missing_sidecars,
      folder_path, root_name, root_path, absolute_path, relative_path, caption, copyright,
      source_mtime, source_size, source_available, source_hash, source_hash_kind, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertKeyword = database.prepare('INSERT INTO keywords(id, catalog_id, local_id, name, parent_id, genealogy) VALUES (?, ?, ?, ?, ?, ?)');
  const insertAssetKeyword = database.prepare('INSERT OR IGNORE INTO asset_keywords(asset_id, keyword_id) VALUES (?, ?)');
  const insertCollection = database.prepare('INSERT INTO collections(id, catalog_id, local_id, name, kind) VALUES (?, ?, ?, ?, ?)');
  const insertAssetCollection = database.prepare('INSERT OR IGNORE INTO asset_collections(asset_id, collection_id) VALUES (?, ?)');
  const keywordIds = new Map<string, number>();
  const collectionIds = new Map<string, number>();
  let availableAssets = 0;
  for (const asset of parsed.records) {
    const sourceHash = hashFiles && asset.absolutePath && asset.sourceAvailable ? await hashFile(asset.absolutePath) : null;
    insertAsset.run(
      asset.id, id, asset.imageId, asset.fileId, asset.filename, asset.extension, asset.fileFormat,
      asset.captureTime, asset.originalCaptureTime, asset.rating, asset.pick, asset.colorLabels,
      asset.width, asset.height, asset.copyName, asset.missingSidecars ? 1 : 0, asset.folderPath,
      asset.rootName, asset.rootPath, asset.absolutePath, asset.relativePath, asset.caption, asset.copyright,
      asset.sourceMtime, asset.sourceSize, asset.sourceAvailable ? 1 : 0, sourceHash, sourceHash ? 'sha256' : null,
      new Date().toISOString()
    );
    if (asset.sourceAvailable) availableAssets += 1;
    for (const keyword of asset.keywords) {
      const keywordId = `${id}:${keyword}`;
      if (!keywordIds.has(keywordId)) {
        insertKeyword.run(keywordId, id, keywordIds.size + 1, keyword, null, keyword);
        keywordIds.set(keywordId, keywordIds.size + 1);
      }
      insertAssetKeyword.run(asset.id, keywordId);
    }
    for (const collection of asset.collections) {
      const collectionId = `${id}:${collection}`;
      if (!collectionIds.has(collectionId)) {
        insertCollection.run(collectionId, id, collectionIds.size + 1, collection, null);
        collectionIds.set(collectionId, collectionIds.size + 1);
      }
      insertAssetCollection.run(asset.id, collectionId);
    }
  }
  const restoreAnnotation = database.prepare(`INSERT OR REPLACE INTO annotations(asset_id, note, tags_json, shortlist, updated_at) VALUES (?, ?, ?, ?, ?)`);
  const parsedAssetIds = new Set(parsed.records.map((asset) => asset.id));
  for (const annotation of oldAnnotations) {
    if (parsedAssetIds.has(annotation.asset_id)) restoreAnnotation.run(annotation.asset_id, annotation.note, annotation.tags_json, annotation.shortlist, annotation.updated_at);
  }
  const restorePreview = database.prepare(`INSERT OR REPLACE INTO previews(asset_id, kind, path, mime_type, width, height, source_mtime, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const preview of oldPreviews) {
    if (parsedAssetIds.has(preview.asset_id)) restorePreview.run(preview.asset_id, preview.kind, preview.path, preview.mime_type, preview.width, preview.height, preview.source_mtime, preview.created_at);
  }
  rebuildAssetSearchIndex(database);
  return { assets: parsed.records.length, availableAssets, warning: parsed.warning };
}

export async function syncArchive(options: SyncOptions): Promise<SyncResult> {
  const selected = options.catalogPaths?.length
    ? await Promise.all(options.catalogPaths.map(async (path): Promise<DiscoveredCatalog> => {
      const details = await stat(path);
      return { path, size: details.size, mtime: details.mtimeMs };
    }))
    : await discoverCatalogs(options.sourceRoot);
  const warnings: string[] = [];
  let assets = 0;
  let availableAssets = 0;
  options.database.exec('BEGIN IMMEDIATE');
  try {
    for (const catalog of selected) {
      console.log(`[archive-sync] importing ${catalog.path}`);
      if (!options.allowLockedCatalog) {
        try {
          await stat(`${catalog.path}.lock`);
          warnings.push(`${catalog.path}: active Lightroom lock file detected; catalog left unchanged.`);
          console.log(`[archive-sync] skipped locked catalog ${catalog.path}`);
          continue;
        } catch {
          // No active lock file.
        }
      }
      const result = await writeCatalog(options.database, catalog, options.sourceRoot, options.hashFiles === true);
      assets += result.assets;
      availableAssets += result.availableAssets;
      if (result.warning) warnings.push(`${catalog.path}: ${result.warning}`);
      console.log(`[archive-sync] indexed ${result.assets} assets (${result.availableAssets} source files available) from ${catalog.path}`);
    }
    options.database.exec('COMMIT');
  } catch (error) {
    options.database.exec('ROLLBACK');
    throw error;
  }
  return { sourceRoot: options.sourceRoot, catalogs: selected.length, assets, availableAssets, warnings };
}

export function listCatalogSummaries(database: DatabaseSync): CatalogSummary[] {
  return database.prepare(`
    SELECT c.id, c.path, c.name, c.size, c.mtime, c.status, c.last_synced_at,
      COUNT(a.id) AS assets, COALESCE(SUM(a.source_available), 0) AS availableAssets
    FROM catalogs c LEFT JOIN assets a ON a.catalog_id = c.id
    GROUP BY c.id ORDER BY c.path
  `).all() as unknown as CatalogSummary[];
}

export function catalogStatus(database: DatabaseSync): { catalogs: number; assets: number; availableAssets: number; previews: number; lastSync: string | null } {
  const counts = database.prepare(`
    SELECT (SELECT COUNT(*) FROM catalogs) AS catalogs,
      (SELECT COUNT(*) FROM assets) AS assets,
      (SELECT COALESCE(SUM(source_available), 0) FROM assets) AS availableAssets,
      (SELECT COUNT(*) FROM previews) AS previews,
      (SELECT MAX(last_synced_at) FROM catalogs) AS lastSync
  `).get() as unknown as { catalogs: number; assets: number; availableAssets: number; previews: number; lastSync: string | null };
  return counts;
}
