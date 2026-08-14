import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import { openCatalogDatabase } from './db.js';
import { ensurePreview, readPreview } from './preview.js';
import { preservationStatus, restorePortableExport, verifyPreservation } from './preservation.js';
import { saveAnnotation, searchAssets } from './search.js';
import { syncArchive } from './sync.js';

async function makeFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'photo-archive-test-'));
  const sourceRoot = join(directory, 'Photography 1');
  const catalogPath = join(sourceRoot, 'Archive', 'fixture.lrcat');
  const sourceFile = join(sourceRoot, 'Trust', 'identity.jpg');
  await mkdir(join(sourceRoot, 'Archive'), { recursive: true });
  await mkdir(join(sourceRoot, 'Trust'), { recursive: true });
  await sharp({ create: { width: 16, height: 12, channels: 3, background: { r: 20, g: 80, b: 140 } } }).jpeg().toFile(sourceFile);
  const sourceCatalog = new DatabaseSync(catalogPath);
  sourceCatalog.exec(`
    CREATE TABLE Adobe_images(id_local INTEGER, rootFile INTEGER, captureTime TEXT, originalCaptureTime TEXT, rating INTEGER, pick INTEGER, colorLabels TEXT, fileWidth INTEGER, fileHeight INTEGER, copyName TEXT, hasMissingSidecars INTEGER, fileFormat TEXT);
    CREATE TABLE AgLibraryFile(id_local INTEGER, originalFilename TEXT, baseName TEXT, extension TEXT, folder INTEGER);
    CREATE TABLE AgLibraryFolder(id_local INTEGER, pathFromRoot TEXT, rootFolder INTEGER);
    CREATE TABLE AgLibraryRootFolder(id_local INTEGER, name TEXT, absolutePath TEXT);
    CREATE TABLE AgLibraryKeyword(id_local INTEGER, name TEXT, parent INTEGER, genealogy TEXT);
    CREATE TABLE AgLibraryKeywordImage(image INTEGER, tag INTEGER);
    CREATE TABLE AgLibraryCollection(id_local INTEGER, name TEXT);
    CREATE TABLE AgLibraryCollectionImage(image INTEGER, collection INTEGER);
    INSERT INTO AgLibraryRootFolder VALUES (1, 'Photography', '/Volumes/Photography 1/');
    INSERT INTO AgLibraryFolder VALUES (1, 'Trust/', 1);
    INSERT INTO AgLibraryFolder VALUES (2, 'Other/', 1);
    INSERT INTO AgLibraryFile VALUES (1, 'identity.jpg', 'identity', 'jpg', 1);
    INSERT INTO AgLibraryFile VALUES (2, 'reliability.jpg', 'reliability', 'jpg', 2);
    INSERT INTO Adobe_images VALUES (101, 1, '2020-01-01T12:00:00', NULL, 5, 1, '', 1200, 800, NULL, 0, 'JPG');
    INSERT INTO Adobe_images VALUES (102, 2, '2020-01-02T12:00:00', NULL, 3, 0, '', 1200, 800, NULL, 0, 'JPG');
    INSERT INTO AgLibraryKeyword VALUES (1, 'Trust', NULL, 'Trust');
    INSERT INTO AgLibraryKeyword VALUES (2, 'Identity', NULL, 'Identity');
    INSERT INTO AgLibraryKeyword VALUES (3, 'Reliability', NULL, 'Reliability');
    INSERT INTO AgLibraryKeywordImage VALUES (101, 1);
    INSERT INTO AgLibraryKeywordImage VALUES (102, 3);
    INSERT INTO AgLibraryCollection VALUES (1, 'Nokia Trust');
    INSERT INTO AgLibraryCollectionImage VALUES (101, 1);
  `);
  sourceCatalog.close();
  return { directory, sourceRoot, catalogPath, sourceFile };
}

test('sync indexes Lightroom metadata, expands Trust vocabulary, and is idempotent', async () => {
  const fixture = await makeFixture();
  const database = openCatalogDatabase(join(fixture.directory, 'catalog.sqlite'));
  try {
    const first = await syncArchive({ database, sourceRoot: fixture.sourceRoot, catalogPaths: [fixture.catalogPath] });
    assert.equal(first.assets, 2);
    assert.equal(first.availableAssets, 1);
    const search = searchAssets(database, { query: 'Trust', limit: 20 });
    assert.ok(search.expandedTerms.includes('reliability'));
    assert.equal(search.results.length, 2);
    assert.ok(search.results.some((result) => result.matchType === 'expanded'));
    const identity = search.results.find((result) => result.filename === 'identity.jpg');
    assert.ok(identity);
    const preview = await ensurePreview(database, identity.id, join(fixture.directory, 'previews'));
    assert.ok(preview);
    assert.equal((await readPreview(preview)).subarray(0, 2).toString('hex'), 'ffd8');
    saveAnnotation(database, identity.id, 'Project Trust', ['Nokia Trust'], true);
    const second = await syncArchive({ database, sourceRoot: fixture.sourceRoot, catalogPaths: [fixture.catalogPath] });
    assert.equal(second.assets, 2);
    const countRow = database.prepare('SELECT COUNT(*) AS count FROM assets').get() as { count: number };
    assert.equal(Number(countRow.count), 2);
    const preserved = searchAssets(database, { query: 'Project Trust', limit: 5, expandQuery: false }).results.find((result) => result.id === identity.id);
    assert.equal(preserved?.annotationNote, 'Project Trust');
    assert.deepEqual(preserved?.annotationTags, ['Nokia Trust']);
    assert.equal(preserved?.shortlist, true);
  } finally {
    database.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('locked catalogs remain unchanged and missing source files stay searchable', async () => {
  const fixture = await makeFixture();
  const database = openCatalogDatabase(join(fixture.directory, 'catalog.sqlite'));
  try {
    await syncArchive({ database, sourceRoot: fixture.sourceRoot, catalogPaths: [fixture.catalogPath] });
    await writeFile(`${fixture.catalogPath}.lock`, 'active');
    const locked = await syncArchive({ database, sourceRoot: fixture.sourceRoot, catalogPaths: [fixture.catalogPath] });
    assert.equal(locked.assets, 0);
    assert.match(locked.warnings[0] ?? '', /active Lightroom lock/);
    await rm(fixture.sourceFile);
    await rm(`${fixture.catalogPath}.lock`);
    await syncArchive({ database, sourceRoot: fixture.sourceRoot, catalogPaths: [fixture.catalogPath] });
    const unavailable = searchAssets(database, { query: 'identity', limit: 5, expandQuery: false });
    assert.equal(unavailable.results[0]?.sourceAvailable, false);
    assert.equal(unavailable.results[0]?.filename, 'identity.jpg');
  } finally {
    database.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('sync creates a portable local preservation bundle that verifies independently', async () => {
  const fixture = await makeFixture();
  const preservationRoot = join(fixture.directory, 'preservation');
  const database = openCatalogDatabase(join(fixture.directory, 'catalog.sqlite'));
  try {
    const result = await syncArchive({
      database,
      sourceRoot: fixture.sourceRoot,
      catalogPaths: [fixture.catalogPath],
      preservationRoot,
    });
    assert.equal(result.preservation?.snapshots, 1);
    assert.ok(result.preservation?.exportPath);
    const exportPath = result.preservation?.exportPath as string;
    const files = ['assets.ndjson', 'keywords.ndjson', 'collections.ndjson', 'annotations.ndjson', 'manifest.json'];
    for (const file of files) assert.ok((await stat(join(exportPath, file))).isFile());
    const status = preservationStatus(database, preservationRoot);
    assert.equal(status.snapshots, 1);
    assert.equal(status.latestExport?.id, result.preservation?.exportId);
    const verified = await verifyPreservation(database);
    assert.equal(verified.ok, true);
    const restored = openCatalogDatabase(join(fixture.directory, 'restored.sqlite'));
    try {
      const restoreResult = await restorePortableExport(restored, exportPath);
      assert.equal(restoreResult.assets, 2);
      assert.equal(searchAssets(restored, { query: 'Trust', expandQuery: false }).results.length, 1);
    } finally {
      restored.close();
    }
    await rm(fixture.sourceRoot, { recursive: true, force: true });
    const offline = await verifyPreservation(database);
    assert.equal(offline.ok, true);
  } finally {
    database.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('migration adds preservation records without removing annotations or previews', async () => {
  const fixture = await makeFixture();
  const databasePath = join(fixture.directory, 'catalog.sqlite');
  const database = openCatalogDatabase(databasePath);
  try {
    await syncArchive({ database, sourceRoot: fixture.sourceRoot, catalogPaths: [fixture.catalogPath] });
    const identity = searchAssets(database, { query: 'identity', expandQuery: false }).results[0];
    assert.ok(identity);
    await ensurePreview(database, identity.id, join(fixture.directory, 'previews'));
    saveAnnotation(database, identity.id, 'Preserve me', ['trust'], true);
    database.exec('DROP TABLE preservation_verifications; DROP TABLE preservation_exports; DROP TABLE preservation_snapshots; DELETE FROM schema_migrations WHERE version = 2;');
  } finally {
    database.close();
  }
  const migrated = openCatalogDatabase(databasePath);
  try {
    const restored = searchAssets(migrated, { query: 'Preserve me', expandQuery: false }).results[0];
    assert.equal(restored?.annotationNote, 'Preserve me');
    assert.equal(restored?.shortlist, true);
    const preview = await ensurePreview(migrated, restored?.id as string, join(fixture.directory, 'previews'));
    assert.ok(preview);
  } finally {
    migrated.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('cached previews refresh from a changed source and remain marked stale offline', async () => {
  const fixture = await makeFixture();
  const database = openCatalogDatabase(join(fixture.directory, 'catalog.sqlite'));
  try {
    await syncArchive({ database, sourceRoot: fixture.sourceRoot, catalogPaths: [fixture.catalogPath] });
    const identity = searchAssets(database, { query: 'identity', expandQuery: false }).results[0];
    assert.ok(identity);
    const previewRoot = join(fixture.directory, 'previews');
    const original = await ensurePreview(database, identity.id, previewRoot);
    assert.equal(original?.stale, false);
    await sharp({ create: { width: 24, height: 18, channels: 3, background: { r: 200, g: 30, b: 10 } } }).jpeg().toFile(fixture.sourceFile);
    await syncArchive({ database, sourceRoot: fixture.sourceRoot, catalogPaths: [fixture.catalogPath] });
    const refreshed = await ensurePreview(database, identity.id, previewRoot);
    assert.equal(refreshed?.stale, false);
    await rm(fixture.sourceFile);
    await syncArchive({ database, sourceRoot: fixture.sourceRoot, catalogPaths: [fixture.catalogPath] });
    const offline = await ensurePreview(database, identity.id, previewRoot);
    assert.equal(offline?.stale, true);
  } finally {
    database.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
