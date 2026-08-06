import { createHash } from 'node:crypto';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { basename, extname, join, normalize, relative, resolve } from 'node:path';
import { access, readdir, stat } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import type { CatalogRecord } from './types.js';

type Row = Record<string, unknown>;

export interface DiscoveredCatalog {
  path: string;
  size: number;
  mtime: number;
  readPath?: string;
}

export interface ParsedCatalog {
  path: string;
  size: number;
  mtime: number;
  records: CatalogRecord[];
  warning: string | null;
}

function value(row: Row, ...keys: string[]): unknown {
  for (const key of keys) {
    if (row[key] !== undefined) return row[key];
  }
  return null;
}

function stringValue(row: Row, ...keys: string[]): string | null {
  const item = value(row, ...keys);
  return item === null || item === undefined ? null : String(item);
}

function numberValue(row: Row, ...keys: string[]): number | null {
  const item = value(row, ...keys);
  if (item === null || item === undefined || item === '') return null;
  const number = Number(item);
  return Number.isFinite(number) ? number : null;
}

function dateValue(row: Row, ...keys: string[]): string | null {
  const item = value(row, ...keys);
  if (item === null || item === undefined || item === '') return null;
  if (typeof item === 'string') return item;
  const number = Number(item);
  if (!Number.isFinite(number)) return String(item);
  const milliseconds = number > 100_000_000_000 ? number : number * 1000;
  const date = new Date(milliseconds);
  return Number.isNaN(date.valueOf()) ? String(item) : date.toISOString();
}

function boolValue(row: Row, ...keys: string[]): boolean {
  const item = value(row, ...keys);
  return item === true || item === 1 || item === '1' || item === 'true';
}

function safeRows(database: DatabaseSync, sql: string, ...params: SQLInputValue[]): Row[] {
  try {
    return database.prepare(sql).all(...params) as Row[];
  } catch {
    return [];
  }
}

function firstColumn(columns: Set<string>, candidates: string[]): string | null {
  return candidates.find((candidate) => columns.has(candidate)) ?? null;
}

function stableId(catalogPath: string, imageId: number): string {
  return createHash('sha256').update(`${catalogPath}\0${imageId}`).digest('hex');
}

function catalogId(catalogPath: string): string {
  return createHash('sha256').update(normalize(resolve(catalogPath))).digest('hex');
}

function buildSourcePath(rootPath: string | null, folderPath: string | null, filename: string): string | null {
  if (!rootPath) return null;
  return join(rootPath, folderPath ?? '', filename);
}

function mapCatalogRootToSource(rootPath: string | null, sourceRoot: string | undefined): string | null {
  if (!rootPath || !sourceRoot) return rootPath;
  const sourceName = basename(sourceRoot).toLowerCase().replace(/[^a-z0-9]/g, '');
  const catalogName = basename(rootPath).toLowerCase().replace(/[^a-z0-9]/g, '');
  return sourceName && catalogName && sourceName === catalogName ? sourceRoot : rootPath;
}

async function checkFile(sourcePath: string | null): Promise<{ available: boolean; mtime: number | null; size: number | null }> {
  if (!sourcePath) return { available: false, mtime: null, size: null };
  try {
    // NAS paths can leave a filesystem stat pending when a share or stale path is unavailable.
    const details = await Promise.race([stat(sourcePath), delay(3000, null)]);
    if (!details) return { available: false, mtime: null, size: null };
    return { available: details.isFile(), mtime: details.mtimeMs, size: details.size };
  } catch {
    return { available: false, mtime: null, size: null };
  }
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function parseKeywords(database: DatabaseSync): Map<number, string> {
  const keywordRows = safeRows(database, 'SELECT id_local, name FROM AgLibraryKeyword');
  const names = new Map<number, string>();
  for (const row of keywordRows) {
    const id = numberValue(row, 'id_local', 'id');
    const name = stringValue(row, 'name', 'keyword');
    if (id !== null && name) names.set(id, name);
  }
  return names;
}

function parseAssetKeywords(database: DatabaseSync, keywordNames: Map<number, string>): Map<number, string[]> {
  const rows = safeRows(database, 'SELECT image, tag FROM AgLibraryKeywordImage');
  const result = new Map<number, string[]>();
  const imageColumn = firstColumn(new Set(rows.flatMap((row) => Object.keys(row))), ['image', 'image_id', 'imageId']);
  const keywordColumn = firstColumn(new Set(rows.flatMap((row) => Object.keys(row))), ['tag', 'keyword', 'keyword_id', 'keywordId']);
  if (!imageColumn || !keywordColumn) return result;
  for (const row of rows) {
    const imageId = numberValue(row, imageColumn);
    const keywordId = numberValue(row, keywordColumn);
    if (imageId === null || keywordId === null) continue;
    const keyword = keywordNames.get(keywordId);
    if (!keyword) continue;
    const current = result.get(imageId) ?? [];
    current.push(keyword);
    result.set(imageId, current);
  }
  return result;
}

function parseCollections(database: DatabaseSync): Map<number, string[]> {
  const names = new Map<number, string>();
  for (const row of safeRows(database, 'SELECT id_local, name FROM AgLibraryCollection')) {
    const id = numberValue(row, 'id_local', 'id');
    const name = stringValue(row, 'name');
    if (id !== null && name) names.set(id, name);
  }
  const links = safeRows(database, 'SELECT image, collection FROM AgLibraryCollectionImage');
  const result = new Map<number, string[]>();
  const columns = new Set(links.flatMap((row) => Object.keys(row)));
  const imageColumn = firstColumn(columns, ['image', 'image_id', 'imageId']);
  const collectionColumn = firstColumn(columns, ['collection', 'collection_id', 'collectionId']);
  if (!imageColumn || !collectionColumn) return result;
  for (const row of links) {
    const imageId = numberValue(row, imageColumn);
    const collectionId = numberValue(row, collectionColumn);
    if (imageId === null || collectionId === null) continue;
    const collection = names.get(collectionId);
    if (!collection) continue;
    const current = result.get(imageId) ?? [];
    current.push(collection);
    result.set(imageId, current);
  }
  return result;
}

export async function discoverCatalogs(sourceRoot: string): Promise<DiscoveredCatalog[]> {
  const discovered: DiscoveredCatalog[] = [];
  async function walk(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    const childDirectories: string[] = [];
    const catalogPaths: string[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name.endsWith('.lrdata')) continue;
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        childDirectories.push(entryPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.lrcat')) {
        catalogPaths.push(entryPath);
      }
    }
    await Promise.all(catalogPaths.map(async (path) => {
      const details = await stat(path);
      discovered.push({ path, size: details.size, mtime: details.mtimeMs });
    }));
    await mapWithConcurrency(childDirectories, 8, async (childDirectory) => {
      await walk(childDirectory);
      return null;
    });
  }
  await access(sourceRoot);
  await walk(sourceRoot);
  return discovered.sort((left, right) => left.path.localeCompare(right.path));
}

export async function parseLightroomCatalog(catalog: DiscoveredCatalog, sourceRoot?: string, checkAvailability = true): Promise<ParsedCatalog> {
  // Immutable URI mode keeps SQLite from creating journals or touching Lightroom's catalog while it is open.
  const database = new DatabaseSync(`file:${catalog.readPath ?? catalog.path}?mode=ro&immutable=1`);
  const warnings: string[] = [];
  const keywordNames = parseKeywords(database);
  const assetKeywords = parseAssetKeywords(database, keywordNames);
  const assetCollections = parseCollections(database);
  const rows = safeRows(database, `
    SELECT
      ai.id_local AS image_id,
      ai.rootFile AS file_id,
      ai.captureTime AS capture_time,
      ai.originalCaptureTime AS original_capture_time,
      ai.rating,
      ai.pick,
      ai.colorLabels AS color_labels,
      ai.fileWidth AS width,
      ai.fileHeight AS height,
      ai.copyName AS copy_name,
      ai.hasMissingSidecars AS missing_sidecars,
      ai.fileFormat AS file_format,
      f.originalFilename AS filename,
      f.baseName AS base_name,
      f.extension,
      folder.pathFromRoot AS folder_path,
      root.name AS root_name,
      root.absolutePath AS root_path
    FROM Adobe_images ai
    LEFT JOIN AgLibraryFile f ON f.id_local = ai.rootFile
    LEFT JOIN AgLibraryFolder folder ON folder.id_local = f.folder
    LEFT JOIN AgLibraryRootFolder root ON root.id_local = folder.rootFolder
  `);
  if (rows.length === 0) warnings.push('No Adobe_images rows were readable from this catalog.');
  const iptcRows = safeRows(database, 'SELECT image, caption, copyright FROM AgLibraryIPTC');
  const iptcByImage = new Map<number, Row>();
  for (const row of iptcRows) {
    const imageId = numberValue(row, 'image', 'image_id', 'imageId');
    if (imageId !== null) iptcByImage.set(imageId, row);
  }
  const mappedRecords = await mapWithConcurrency(rows, 32, async (row): Promise<CatalogRecord | null> => {
    const imageId = numberValue(row, 'image_id');
    if (imageId === null) return null;
    const filename = stringValue(row, 'filename', 'base_name') ?? `lightroom-${imageId}`;
    const folderPath = stringValue(row, 'folder_path');
    const rootPath = stringValue(row, 'root_path');
    const mappedRootPath = mapCatalogRootToSource(rootPath, sourceRoot);
    const absolutePath = buildSourcePath(mappedRootPath, folderPath, filename);
    const fileStatus = checkAvailability
      ? await checkFile(absolutePath)
      : { available: false, mtime: null, size: null };
    const iptc = iptcByImage.get(imageId);
    return {
      id: stableId(catalog.path, imageId),
      imageId,
      fileId: numberValue(row, 'file_id'),
      filename,
      extension: stringValue(row, 'extension') ?? extname(filename).replace(/^\./, '').toLowerCase(),
      fileFormat: stringValue(row, 'file_format'),
      captureTime: dateValue(row, 'capture_time'),
      originalCaptureTime: dateValue(row, 'original_capture_time'),
      rating: numberValue(row, 'rating'),
      pick: numberValue(row, 'pick'),
      colorLabels: stringValue(row, 'color_labels'),
      width: numberValue(row, 'width'),
      height: numberValue(row, 'height'),
      copyName: stringValue(row, 'copy_name'),
      missingSidecars: boolValue(row, 'missing_sidecars'),
      folderPath,
      rootName: stringValue(row, 'root_name'),
      rootPath,
      absolutePath,
      relativePath: mappedRootPath && absolutePath ? relative(mappedRootPath, absolutePath) : null,
      caption: iptc ? stringValue(iptc, 'caption', 'captionWriter', 'description') : null,
      copyright: iptc ? stringValue(iptc, 'copyright', 'copyrightNotice') : null,
      sourceMtime: fileStatus.mtime,
      sourceSize: fileStatus.size,
      sourceAvailable: fileStatus.available,
      keywords: assetKeywords.get(imageId) ?? [],
      collections: assetCollections.get(imageId) ?? [],
      annotationNote: null,
      annotationTags: [],
      shortlist: false
    };
  });
  const records = mappedRecords.filter((record): record is CatalogRecord => record !== null);
  database.close();
  return { ...catalog, records, warning: warnings.length ? warnings.join(' ') : null };
}

export function catalogKey(catalogPath: string): string {
  return catalogId(catalogPath);
}
