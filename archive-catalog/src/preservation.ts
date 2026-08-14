import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { currentSchemaVersion, rebuildAssetSearchIndex } from './db.js';
import { catalogKey, type DiscoveredCatalog } from './lightroom.js';
import type { PreservationStatus } from './types.js';

const PARSER_VERSION = 'lightroom-archive-parser/1';
const METADATA_COVERAGE_VERSION = 'searchable-lightroom-metadata/1';
const OMITTED_LIGHTROOM_DATA = [
  'develop settings',
  'edit history',
  'virtual-copy relationships',
  'face metadata',
  'unparsed Lightroom tables',
];

interface SnapshotRow {
  id: string;
  catalog_id: string;
  source_path: string;
  source_size: number;
  source_mtime: number;
  source_hash: string;
  snapshot_path: string;
  indexed_assets: number;
  parser_version: string;
  schema_version: number;
  created_at: string;
}

interface ExportManifest {
  id: string;
  createdAt: string;
  schemaVersion: number;
  parserVersion: string;
  metadataCoverageVersion: string;
  searchableFields: string[];
  omittedLightroomData: string[];
  catalogs: Array<Record<string, unknown>>;
  counts: Record<string, number>;
  checksums: Record<string, string>;
}

export interface PreservationResult {
  snapshots: number;
  exportId: string;
  exportPath: string;
}

export interface RestoreResult {
  assets: number;
  keywords: number;
  collections: number;
  annotations: number;
}

function hashStream(path: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk: Buffer) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolveHash(hash.digest('hex')));
  });
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, path);
}

async function writeNdjson(path: string, rows: unknown[]): Promise<void> {
  const stream = createWriteStream(path, { encoding: 'utf8' });
  try {
    for (const row of rows) {
      if (!stream.write(`${JSON.stringify(row)}\n`)) await once(stream, 'drain');
    }
    stream.end();
    await once(stream, 'finish');
  } catch (error) {
    stream.destroy();
    throw error;
  }
}

function isInside(path: string, parent: string): boolean {
  const candidate = resolve(path);
  const root = resolve(parent);
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

export async function validatePreservationRoot(preservationRoot: string, sourceRoot: string): Promise<string> {
  const resolvedRoot = resolve(preservationRoot);
  if (isInside(resolvedRoot, sourceRoot)) {
    throw new Error('ARCHIVE_PRESERVATION_ROOT must be outside the Photography 1 source mount.');
  }
  await mkdir(resolvedRoot, { recursive: true });
  await access(resolvedRoot, constants.R_OK | constants.W_OK);
  const probe = join(resolvedRoot, `.archive-write-probe-${randomUUID()}`);
  await writeFile(probe, 'ok', { flag: 'wx' });
  await rm(probe, { force: true });
  return resolvedRoot;
}

function latestSnapshot(database: DatabaseSync, catalog: DiscoveredCatalog): SnapshotRow | null {
  return database.prepare(`
    SELECT * FROM preservation_snapshots
    WHERE catalog_id = ? AND source_path = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(catalogKey(catalog.path), catalog.path) as SnapshotRow | undefined ?? null;
}

export async function catalogSnapshotIsCurrent(database: DatabaseSync, catalog: DiscoveredCatalog, verifyHash: boolean): Promise<boolean> {
  const snapshot = latestSnapshot(database, catalog);
  if (!snapshot || snapshot.source_size !== catalog.size || snapshot.source_mtime !== catalog.mtime) return false;
  try {
    await stat(snapshot.snapshot_path);
  } catch {
    return false;
  }
  return !verifyHash || snapshot.source_hash === await hashStream(catalog.path);
}

export async function preserveCatalogSnapshot(database: DatabaseSync, preservationRoot: string, catalog: DiscoveredCatalog, indexedAssets: number): Promise<SnapshotRow> {
  const catalogId = catalogKey(catalog.path);
  const sourceHash = await hashStream(catalog.path);
  const snapshotDirectory = join(preservationRoot, 'catalogs', catalogId);
  const snapshotPath = join(snapshotDirectory, `${sourceHash}.lrcat`);
  await mkdir(snapshotDirectory, { recursive: true });
  try {
    await stat(snapshotPath);
  } catch {
    const temporaryPath = join(snapshotDirectory, `.${basename(snapshotPath)}.${randomUUID()}.tmp`);
    await copyFile(catalog.path, temporaryPath);
    const copiedHash = await hashStream(temporaryPath);
    if (copiedHash !== sourceHash) {
      await rm(temporaryPath, { force: true });
      throw new Error(`Catalog changed while snapshotting ${catalog.path}; retry after Lightroom is closed.`);
    }
    await chmod(temporaryPath, 0o444);
    await rename(temporaryPath, snapshotPath);
  }
  const createdAt = new Date().toISOString();
  const schemaVersion = currentSchemaVersion(database);
  const id = `${catalogId}:${sourceHash}`;
  database.prepare(`
    INSERT INTO preservation_snapshots(
      id, catalog_id, source_path, source_size, source_mtime, source_hash, snapshot_path,
      indexed_assets, parser_version, schema_version, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      source_size = excluded.source_size, source_mtime = excluded.source_mtime,
      snapshot_path = excluded.snapshot_path, indexed_assets = excluded.indexed_assets,
      parser_version = excluded.parser_version, schema_version = excluded.schema_version,
      created_at = excluded.created_at
  `).run(id, catalogId, catalog.path, catalog.size, catalog.mtime, sourceHash, snapshotPath, indexedAssets, PARSER_VERSION, schemaVersion, createdAt);
  const snapshot = database.prepare('SELECT * FROM preservation_snapshots WHERE id = ?').get(id) as unknown as SnapshotRow;
  await writeJsonAtomically(join(snapshotDirectory, 'manifest.json'), {
    id: snapshot.id,
    catalogId: snapshot.catalog_id,
    originalPath: snapshot.source_path,
    sourceSize: snapshot.source_size,
    sourceMtime: snapshot.source_mtime,
    sourceHash: snapshot.source_hash,
    snapshotPath: snapshot.snapshot_path,
    indexedAssets: snapshot.indexed_assets,
    parserVersion: snapshot.parser_version,
    schemaVersion: snapshot.schema_version,
    createdAt: snapshot.created_at,
    sourceReadOnly: true,
  });
  return snapshot;
}

function records(database: DatabaseSync, sql: string): Array<Record<string, unknown>> {
  return database.prepare(sql).all() as Array<Record<string, unknown>>;
}

async function createExport(database: DatabaseSync, preservationRoot: string): Promise<{ id: string; path: string }> {
  const id = `export-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const exportsRoot = join(preservationRoot, 'exports');
  await mkdir(exportsRoot, { recursive: true });
  const temporaryRoot = await mkdtemp(join(preservationRoot, '.archive-export-'));
  const temporaryBundle = join(temporaryRoot, id);
  const finalBundle = join(exportsRoot, id);
  await mkdir(temporaryBundle);
  try {
    const assets = records(database, 'SELECT * FROM assets ORDER BY id');
    const keywords = records(database, 'SELECT * FROM keywords ORDER BY id');
    const collections = records(database, 'SELECT * FROM collections ORDER BY id');
    const annotations = records(database, 'SELECT * FROM annotations ORDER BY asset_id');
    const assetKeywords = records(database, 'SELECT * FROM asset_keywords ORDER BY asset_id, keyword_id');
    const assetCollections = records(database, 'SELECT * FROM asset_collections ORDER BY asset_id, collection_id');
    const catalogs = records(database, 'SELECT * FROM catalogs ORDER BY path');
    await writeNdjson(join(temporaryBundle, 'assets.ndjson'), assets);
    await writeNdjson(join(temporaryBundle, 'keywords.ndjson'), keywords);
    await writeNdjson(join(temporaryBundle, 'collections.ndjson'), collections);
    await writeNdjson(join(temporaryBundle, 'annotations.ndjson'), annotations);
    await writeNdjson(join(temporaryBundle, 'asset_keywords.ndjson'), assetKeywords);
    await writeNdjson(join(temporaryBundle, 'asset_collections.ndjson'), assetCollections);
    const checksums = Object.fromEntries(await Promise.all(['assets.ndjson', 'keywords.ndjson', 'collections.ndjson', 'annotations.ndjson', 'asset_keywords.ndjson', 'asset_collections.ndjson'].map(async (name) => [name, await hashStream(join(temporaryBundle, name))])));
    const manifest: ExportManifest = {
      id,
      createdAt: new Date().toISOString(),
      schemaVersion: currentSchemaVersion(database),
      parserVersion: PARSER_VERSION,
      metadataCoverageVersion: METADATA_COVERAGE_VERSION,
      searchableFields: ['filename', 'folder path', 'source path', 'capture dates', 'rating', 'pick', 'color labels', 'caption', 'copyright', 'keywords', 'collections', 'annotations'],
      omittedLightroomData: OMITTED_LIGHTROOM_DATA,
      catalogs,
      counts: { assets: assets.length, keywords: keywords.length, collections: collections.length, annotations: annotations.length, assetKeywords: assetKeywords.length, assetCollections: assetCollections.length },
      checksums,
    };
    await writeJsonAtomically(join(temporaryBundle, 'manifest.json'), manifest);
    await rename(temporaryBundle, finalBundle);
    database.prepare(`
      INSERT INTO preservation_exports(
        id, path, manifest_path, schema_version, created_at, assets_count, keywords_count,
        collections_count, annotations_count, checksums_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, finalBundle, join(finalBundle, 'manifest.json'), manifest.schemaVersion, manifest.createdAt, assets.length, keywords.length, collections.length, annotations.length, JSON.stringify(checksums));
    return { id, path: finalBundle };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function readNdjson(path: string): Promise<Array<Record<string, unknown>>> {
  const text = await readFile(path, 'utf8');
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function readVerifiedExport(bundlePath: string): Promise<ExportManifest> {
  const manifest = JSON.parse(await readFile(join(bundlePath, 'manifest.json'), 'utf8')) as ExportManifest;
  for (const [name, checksum] of Object.entries(manifest.checksums)) {
    if (await hashStream(join(bundlePath, name)) !== checksum) throw new Error(`Export checksum mismatch: ${name}`);
  }
  return manifest;
}

function insertRows(database: DatabaseSync, table: string, columns: string[], rows: Array<Record<string, unknown>>): void {
  if (!rows.length) return;
  const statement = database.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`);
  for (const row of rows) statement.run(...columns.map((column) => row[column] as string | number | null ?? null));
}

export async function restorePortableExport(database: DatabaseSync, bundlePath: string): Promise<RestoreResult> {
  const existing = database.prepare('SELECT COUNT(*) AS count FROM assets').get() as { count: number };
  if (Number(existing.count) > 0) throw new Error('Restore requires a clean archive database; refusing to overwrite indexed records.');
  const manifest = await readVerifiedExport(bundlePath);
  if (manifest.schemaVersion > currentSchemaVersion(database)) throw new Error(`Export requires schema ${manifest.schemaVersion}, but this database supports ${currentSchemaVersion(database)}.`);
  const [assets, keywords, collections, annotations, assetKeywords, assetCollections] = await Promise.all([
    readNdjson(join(bundlePath, 'assets.ndjson')),
    readNdjson(join(bundlePath, 'keywords.ndjson')),
    readNdjson(join(bundlePath, 'collections.ndjson')),
    readNdjson(join(bundlePath, 'annotations.ndjson')),
    readNdjson(join(bundlePath, 'asset_keywords.ndjson')),
    readNdjson(join(bundlePath, 'asset_collections.ndjson')),
  ]);
  database.exec('BEGIN IMMEDIATE');
  try {
    insertRows(database, 'catalogs', ['id', 'path', 'name', 'size', 'mtime', 'status', 'warning', 'last_synced_at'], manifest.catalogs);
    insertRows(database, 'assets', ['id', 'catalog_id', 'catalog_image_id', 'file_id', 'filename', 'extension', 'file_format', 'capture_time', 'original_capture_time', 'rating', 'pick', 'color_labels', 'width', 'height', 'copy_name', 'missing_sidecars', 'folder_path', 'root_name', 'root_path', 'absolute_path', 'relative_path', 'caption', 'copyright', 'source_mtime', 'source_size', 'source_available', 'source_hash', 'source_hash_kind', 'last_seen_at'], assets);
    insertRows(database, 'keywords', ['id', 'catalog_id', 'local_id', 'name', 'parent_id', 'genealogy'], keywords);
    insertRows(database, 'collections', ['id', 'catalog_id', 'local_id', 'name', 'kind'], collections);
    insertRows(database, 'asset_keywords', ['asset_id', 'keyword_id'], assetKeywords);
    insertRows(database, 'asset_collections', ['asset_id', 'collection_id'], assetCollections);
    insertRows(database, 'annotations', ['asset_id', 'note', 'tags_json', 'shortlist', 'updated_at'], annotations);
    database.prepare(`
      INSERT INTO preservation_exports(id, path, manifest_path, schema_version, created_at, assets_count, keywords_count, collections_count, annotations_count, checksums_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(manifest.id, bundlePath, join(bundlePath, 'manifest.json'), manifest.schemaVersion, manifest.createdAt, assets.length, keywords.length, collections.length, annotations.length, JSON.stringify(manifest.checksums));
    rebuildAssetSearchIndex(database);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  return { assets: assets.length, keywords: keywords.length, collections: collections.length, annotations: annotations.length };
}

export async function preserveArchive(database: DatabaseSync, preservationRoot: string, sourceRoot: string, catalogs: Array<{ catalog: DiscoveredCatalog; indexedAssets: number }>, verifyCatalogs = false): Promise<PreservationResult> {
  const resolvedRoot = await validatePreservationRoot(preservationRoot, sourceRoot);
  let snapshots = 0;
  for (const entry of catalogs) {
    if (!await catalogSnapshotIsCurrent(database, entry.catalog, verifyCatalogs)) {
      await preserveCatalogSnapshot(database, resolvedRoot, entry.catalog, entry.indexedAssets);
    }
    snapshots += 1;
  }
  const exported = await createExport(database, resolvedRoot);
  return { snapshots, exportId: exported.id, exportPath: exported.path };
}

export async function verifyPreservation(database: DatabaseSync): Promise<{ ok: boolean; failures: string[]; checkedSnapshots: number; checkedExports: number }> {
  const failures: string[] = [];
  const integrity = database.prepare('PRAGMA integrity_check').get() as Record<string, unknown> | undefined;
  if (Object.values(integrity ?? {})[0] !== 'ok') failures.push('SQLite integrity check failed.');
  const snapshots = records(database, 'SELECT * FROM preservation_snapshots') as unknown as SnapshotRow[];
  for (const snapshot of snapshots) {
    try {
      if (await hashStream(snapshot.snapshot_path) !== snapshot.source_hash) failures.push(`Snapshot checksum mismatch: ${snapshot.snapshot_path}`);
    } catch {
      failures.push(`Snapshot unavailable: ${snapshot.snapshot_path}`);
    }
  }
  const exports = records(database, 'SELECT * FROM preservation_exports') as Array<Record<string, unknown>>;
  for (const exportRow of exports) {
    try {
      const manifest = await readVerifiedExport(String(exportRow.path));
      if (manifest.schemaVersion > currentSchemaVersion(database)) failures.push(`Export requires newer schema: ${manifest.id}`);
      const expected = JSON.parse(String(exportRow.checksums_json)) as Record<string, string>;
      if (JSON.stringify(expected) !== JSON.stringify(manifest.checksums)) failures.push(`Export manifest checksum mismatch: ${manifest.id}`);
      if (manifest.counts.assets !== Number(exportRow.assets_count) || manifest.counts.keywords !== Number(exportRow.keywords_count) || manifest.counts.collections !== Number(exportRow.collections_count) || manifest.counts.annotations !== Number(exportRow.annotations_count)) {
        failures.push(`Export count mismatch: ${manifest.id}`);
      }
    } catch (error) {
      failures.push(`Export unavailable: ${String(exportRow.id)} (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  const result = { ok: failures.length === 0, failures, checkedSnapshots: snapshots.length, checkedExports: exports.length };
  database.prepare('INSERT INTO preservation_verifications(id, created_at, ok, failures_json, checked_snapshots, checked_exports) VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), new Date().toISOString(), result.ok ? 1 : 0, JSON.stringify(result.failures), result.checkedSnapshots, result.checkedExports);
  return result;
}

export function preservationStatus(database: DatabaseSync, preservationRoot: string | null): PreservationStatus {
  const snapshots = database.prepare('SELECT COUNT(*) AS count FROM preservation_snapshots').get() as { count: number };
  const latestExport = database.prepare('SELECT id, created_at, path FROM preservation_exports ORDER BY created_at DESC LIMIT 1').get() as { id: string; created_at: string; path: string } | undefined;
  const verification = database.prepare('SELECT created_at, ok, failures_json FROM preservation_verifications ORDER BY created_at DESC LIMIT 1').get() as { created_at: string; ok: number; failures_json: string } | undefined;
  return {
    required: true,
    root: preservationRoot,
    snapshots: Number(snapshots.count),
    latestExport: latestExport ? { id: latestExport.id, createdAt: latestExport.created_at, path: latestExport.path } : null,
    lastVerification: verification ? { createdAt: verification.created_at, ok: verification.ok === 1, failures: JSON.parse(verification.failures_json) as string[] } : null,
    metadataCoverageVersion: METADATA_COVERAGE_VERSION,
  };
}
