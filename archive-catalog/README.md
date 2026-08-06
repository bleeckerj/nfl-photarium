# Photo Archive Catalog

The complete operator and developer guide is [docs/photo-archive-catalog.md](../docs/photo-archive-catalog.md).

This service is the offline search index for Lightroom catalogs stored on the Photography 1 NAS. It is deliberately separate from the global Photarium catalog so a large historical archive does not add thousands of cold records to the normal image search path.

## Storage and source safety

- `/data/catalog.sqlite` is the derived SQLite/FTS5 metadata database.
- `/data/previews` contains generated thumbnails in a separate Docker volume.
- `/data/backups` is reserved for SQLite backup snapshots.
- `/sources/photography-1` is mounted read-only.
- Lightroom catalogs are opened using SQLite immutable read-only URI mode.
- A neighboring `.lrcat.lock` prevents import unless `--allow-locked` is explicitly supplied.
- Missing source files remain indexed with `sourceAvailable: false`; sync never deletes them from the archive database.

## Run

From the repository root:

```bash
docker compose up -d photo-archive-catalog
npm run archive:sync
npm run archive:sync -- --hash
```

`--hash` is an optional, slower content-hash pass. `--allow-locked` is an explicit override for a catalog that Lightroom may still be using.

The service exposes its internal API on port `8790`. The MCP server uses `ARCHIVE_CATALOG_BASE_URL` to reach it.

## Search model

Search covers filenames, folder paths, Lightroom keywords, captions, copyright, collections, and separate archive annotations. The initial related-term vocabulary is local and curated; it expands terms such as `trust` toward identity, privacy, security, safety, reliability, verification, and reputation. Expanded matches are labeled in the response and never written back as Lightroom keywords.

See the complete guide for the HTTP API, MCP tool contracts, offline behavior, backup/restore, troubleshooting, and rollout procedure.
