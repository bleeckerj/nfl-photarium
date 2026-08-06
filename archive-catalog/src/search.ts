import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { rebuildAssetSearchIndex } from './db.js';
import { expandTerms } from './vocabulary.js';
import type { CatalogRecord, SearchFilters, SearchResult } from './types.js';

type Row = Record<string, unknown>;

function stringValue(row: Row, key: string): string | null {
  const value = row[key];
  return value === null || value === undefined ? null : String(value);
}

function numberValue(row: Row, key: string): number | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function booleanValue(row: Row, key: string): boolean {
  return row[key] === 1 || row[key] === true;
}

function fieldText(row: Row, key: string): string {
  return stringValue(row, key)?.toLowerCase() ?? '';
}

function matchedFields(row: Row, query: string): string[] {
  const fields: Array<[string, string]> = [
    ['filename', fieldText(row, 'filename')],
    ['path', `${fieldText(row, 'folder_path')} ${fieldText(row, 'absolute_path')}`],
    ['keyword', fieldText(row, 'keyword_text')],
    ['caption', fieldText(row, 'caption')],
    ['copyright', fieldText(row, 'copyright')],
    ['collection', fieldText(row, 'collection_text')],
    ['annotation', fieldText(row, 'annotation_text')]
  ];
  const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return fields.filter(([, text]) => terms.some((term) => text.includes(term))).map(([name]) => name);
}

function toRecord(row: Row): CatalogRecord {
  const parseArray = (key: string, fallbackKey: string): string[] => {
    const serialized = stringValue(row, key);
    if (serialized) {
      try {
        const parsed = JSON.parse(serialized) as unknown;
        if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === 'string');
      } catch {
        // Fall back to the searchable text projection for older rows.
      }
    }
    return (stringValue(row, fallbackKey) ?? '').split(' ').filter(Boolean);
  };
  const keywords = parseArray('keyword_json', 'keyword_text');
  const collections = parseArray('collection_json', 'collection_text');
  const annotationTags = parseArray('annotation_tags_json', 'annotation_text');
  return {
    id: String(row.id),
    imageId: Number(row.catalog_image_id),
    fileId: numberValue(row, 'file_id'),
    filename: String(row.filename),
    extension: stringValue(row, 'extension'),
    fileFormat: stringValue(row, 'file_format'),
    captureTime: stringValue(row, 'capture_time'),
    originalCaptureTime: stringValue(row, 'original_capture_time'),
    rating: numberValue(row, 'rating'),
    pick: numberValue(row, 'pick'),
    colorLabels: stringValue(row, 'color_labels'),
    width: numberValue(row, 'width'),
    height: numberValue(row, 'height'),
    copyName: stringValue(row, 'copy_name'),
    missingSidecars: booleanValue(row, 'missing_sidecars'),
    folderPath: stringValue(row, 'folder_path'),
    rootName: stringValue(row, 'root_name'),
    rootPath: stringValue(row, 'root_path'),
    absolutePath: stringValue(row, 'absolute_path'),
    relativePath: stringValue(row, 'relative_path'),
    caption: stringValue(row, 'caption'),
    copyright: stringValue(row, 'copyright'),
    sourceMtime: numberValue(row, 'source_mtime'),
    sourceSize: numberValue(row, 'source_size'),
    sourceAvailable: booleanValue(row, 'source_available'),
    keywords,
    collections,
    annotationNote: stringValue(row, 'annotation_note'),
    annotationTags,
    shortlist: booleanValue(row, 'annotation_shortlist')
  };
}

const baseSelect = `
  SELECT a.*, f.keyword_text, f.collection_text, f.annotation_text,
    an.note AS annotation_note, an.tags_json AS annotation_tags_json, an.shortlist AS annotation_shortlist,
    (SELECT json_group_array(k.name) FROM asset_keywords ak JOIN keywords k ON k.id = ak.keyword_id WHERE ak.asset_id = a.id) AS keyword_json,
    (SELECT json_group_array(c.name) FROM asset_collections ac JOIN collections c ON c.id = ac.collection_id WHERE ac.asset_id = a.id) AS collection_json,
    f.rank AS fts_rank
  FROM assets a
  LEFT JOIN assets_fts f ON f.asset_id = a.id
  LEFT JOIN annotations an ON an.asset_id = a.id
`;

function buildWhere(filters: SearchFilters, params: SQLInputValue[]): string {
  const where = ['1 = 1'];
  if (filters.from) {
    where.push('a.capture_time >= ?');
    params.push(filters.from);
  }
  if (filters.to) {
    where.push('a.capture_time <= ?');
    params.push(filters.to);
  }
  if (filters.minRating !== undefined) {
    where.push('COALESCE(a.rating, 0) >= ?');
    params.push(filters.minRating);
  }
  if (filters.pick !== undefined) {
    where.push('a.pick = ?');
    params.push(filters.pick);
  }
  if (filters.catalogId) {
    where.push('a.catalog_id = ?');
    params.push(filters.catalogId);
  }
  if (filters.path) {
    where.push('(a.absolute_path LIKE ? OR a.folder_path LIKE ?)');
    params.push(`%${filters.path}%`, `%${filters.path}%`);
  }
  if (filters.keyword) {
    where.push(`EXISTS (SELECT 1 FROM asset_keywords ak JOIN keywords k ON k.id = ak.keyword_id WHERE ak.asset_id = a.id AND k.name LIKE ?)`);
    params.push(`%${filters.keyword}%`);
  }
  if (filters.collection) {
    where.push(`EXISTS (SELECT 1 FROM asset_collections ac JOIN collections c ON c.id = ac.collection_id WHERE ac.asset_id = a.id AND c.name LIKE ?)`);
    params.push(`%${filters.collection}%`);
  }
  return where.join(' AND ');
}

function ftsQuery(terms: string[]): string | null {
  const normalized = terms.map((term) => term.trim()).filter(Boolean).map((term) => `"${term.replaceAll('"', '""')}"`);
  return normalized.length ? normalized.join(' AND ') : null;
}

function expandedFtsQuery(query: string, expandedTerms: string[]): string | null {
  const queryTerms = query.split(/\s+/).map((term) => term.trim()).filter(Boolean);
  const mappedTerms = new Set<string>();
  const baseTerms: string[] = [];
  for (const term of queryTerms) {
    if (expandTerms(term).length) mappedTerms.add(term);
    else baseTerms.push(term);
  }
  const alternatives = [...mappedTerms, ...expandedTerms];
  const alternativeQuery = ftsQuery(alternatives);
  if (!alternativeQuery) return ftsQuery(queryTerms);
  const baseQuery = ftsQuery(baseTerms);
  return baseQuery ? `${baseQuery} AND (${alternativeQuery.replaceAll(' AND ', ' OR ')})` : `(${alternativeQuery.replaceAll(' AND ', ' OR ')})`;
}

function fetchRows(database: DatabaseSync, filters: SearchFilters, textQuery: string | null): Row[] {
  const params: SQLInputValue[] = [];
  const where = buildWhere(filters, params);
  if (textQuery) {
    where.concat();
    params.unshift(textQuery);
  }
  const textClause = textQuery ? 'a.id IN (SELECT asset_id FROM assets_fts WHERE assets_fts MATCH ?) AND ' : '';
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);
  const sql = `${baseSelect} WHERE ${textClause}${where} ORDER BY COALESCE(f.rank, 0), a.capture_time DESC LIMIT ${limit} OFFSET ${offset}`;
  return database.prepare(sql).all(...params) as Row[];
}

export function searchAssets(database: DatabaseSync, filters: SearchFilters): { results: SearchResult[]; expandedTerms: string[] } {
  const query = filters.query?.trim() ?? '';
  const exactRows = fetchRows(database, filters, ftsQuery(query.split(/\s+/)));
  const exactIds = new Set(exactRows.map((row) => String(row.id)));
  const results: SearchResult[] = exactRows.map((row) => ({
    ...toRecord(row),
    matchType: 'exact',
    matchedFields: query ? matchedFields(row, query) : [],
    rank: Number(row.fts_rank ?? 0)
  }));
  const expandedTerms = filters.expandQuery === false || !query ? [] : expandTerms(query);
  if (expandedTerms.length) {
    const expandedQuery = expandedFtsQuery(query, expandedTerms);
    const expandedRows = fetchRows(database, { ...filters, limit: Math.min((filters.limit ?? 50) * 2, 200), offset: 0 }, expandedQuery);
    for (const row of expandedRows) {
      const id = String(row.id);
      if (exactIds.has(id)) continue;
      results.push({
        ...toRecord(row),
        matchType: 'expanded',
        matchedFields: matchedFields(row, expandedTerms.join(' ')),
        rank: Number(row.fts_rank ?? 0)
      });
      if (results.length >= Math.min(filters.limit ?? 50, 200)) break;
    }
  }
  return { results: results.slice(0, Math.min(filters.limit ?? 50, 200)), expandedTerms };
}

export function getAsset(database: DatabaseSync, id: string): CatalogRecord | null {
  const row = database.prepare(`${baseSelect} WHERE a.id = ?`).get(id) as Row | undefined;
  return row ? toRecord(row) : null;
}

export function listKeywords(database: DatabaseSync, query?: string): Array<{ name: string; count: number }> {
  const like = query ? `%${query}%` : '%';
  return database.prepare(`SELECT k.name, COUNT(ak.asset_id) AS count FROM keywords k LEFT JOIN asset_keywords ak ON ak.keyword_id = k.id WHERE k.name LIKE ? GROUP BY k.name ORDER BY count DESC, k.name LIMIT 500`).all(like) as Array<{ name: string; count: number }>;
}

export function listCollections(database: DatabaseSync, query?: string): Array<{ name: string; count: number }> {
  const like = query ? `%${query}%` : '%';
  return database.prepare(`SELECT c.name, COUNT(ac.asset_id) AS count FROM collections c LEFT JOIN asset_collections ac ON ac.collection_id = c.id WHERE c.name LIKE ? GROUP BY c.name ORDER BY count DESC, c.name LIMIT 500`).all(like) as Array<{ name: string; count: number }>;
}

export function saveAnnotation(database: DatabaseSync, assetId: string, note: string | null, tags: string[], shortlist: boolean): CatalogRecord | null {
  database.prepare(`
    INSERT INTO annotations(asset_id, note, tags_json, shortlist, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(asset_id) DO UPDATE SET note = excluded.note, tags_json = excluded.tags_json, shortlist = excluded.shortlist, updated_at = excluded.updated_at
  `).run(assetId, note, JSON.stringify(tags), shortlist ? 1 : 0, new Date().toISOString());
  rebuildAssetSearchIndex(database, [assetId]);
  return getAsset(database, assetId);
}
