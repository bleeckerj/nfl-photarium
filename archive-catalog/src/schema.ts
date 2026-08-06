export const schemaSql = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS catalogs (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  size INTEGER NOT NULL,
  mtime INTEGER NOT NULL,
  status TEXT NOT NULL,
  warning TEXT,
  last_synced_at TEXT
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  catalog_id TEXT NOT NULL REFERENCES catalogs(id) ON DELETE CASCADE,
  catalog_image_id INTEGER NOT NULL,
  file_id INTEGER,
  filename TEXT NOT NULL,
  extension TEXT,
  file_format TEXT,
  capture_time TEXT,
  original_capture_time TEXT,
  rating REAL,
  pick INTEGER,
  color_labels TEXT,
  width INTEGER,
  height INTEGER,
  copy_name TEXT,
  missing_sidecars INTEGER NOT NULL DEFAULT 0,
  folder_path TEXT,
  root_name TEXT,
  root_path TEXT,
  absolute_path TEXT,
  relative_path TEXT,
  caption TEXT,
  copyright TEXT,
  source_mtime INTEGER,
  source_size INTEGER,
  source_available INTEGER NOT NULL DEFAULT 0,
  source_hash TEXT,
  source_hash_kind TEXT,
  last_seen_at TEXT NOT NULL,
  UNIQUE(catalog_id, catalog_image_id)
);

CREATE INDEX IF NOT EXISTS assets_catalog_idx ON assets(catalog_id);
CREATE INDEX IF NOT EXISTS assets_capture_idx ON assets(capture_time);
CREATE INDEX IF NOT EXISTS assets_path_idx ON assets(absolute_path);

CREATE TABLE IF NOT EXISTS keywords (
  id TEXT PRIMARY KEY,
  catalog_id TEXT NOT NULL REFERENCES catalogs(id) ON DELETE CASCADE,
  local_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  parent_id TEXT,
  genealogy TEXT
);

CREATE TABLE IF NOT EXISTS asset_keywords (
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  keyword_id TEXT NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  PRIMARY KEY(asset_id, keyword_id)
);

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  catalog_id TEXT NOT NULL REFERENCES catalogs(id) ON DELETE CASCADE,
  local_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  kind TEXT
);

CREATE TABLE IF NOT EXISTS asset_collections (
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  PRIMARY KEY(asset_id, collection_id)
);

CREATE TABLE IF NOT EXISTS annotations (
  asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
  note TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  shortlist INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS previews (
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  source_mtime INTEGER,
  created_at TEXT NOT NULL,
  PRIMARY KEY(asset_id, kind)
);

CREATE VIRTUAL TABLE IF NOT EXISTS assets_fts USING fts5(
  asset_id UNINDEXED,
  filename,
  folder_path,
  keyword_text,
  caption,
  copyright,
  collection_text,
  annotation_text,
  tokenize='unicode61 remove_diacritics 2'
);
`;
