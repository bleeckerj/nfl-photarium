# `fs:ingest` README

`fs:ingest` is a recursive filesystem ingestion CLI that uploads local images/videos into Photarium/Cloudflare Images endpoints, optionally enriches image metadata with AI, and maintains a local checkpoint cache to avoid re-uploading work.

Script:
- `scripts/fs-ingest.mjs`

Package command:
- `npm run fs:ingest -- <args>`

## What It Does

For each media file under `--root`, `fs:ingest` can:
- Detect type (`image`/`video`) by extension
- Build base tags from `--tags` and optional path tags
- Generate AI metadata for images (`displayName`, `tags`)
- Append a user-specified image tag (`--append-image-tag`)
- Upload to the proper API endpoint
- Write checkpoint entries so future runs skip known files

## Supported File Types

Images:
- `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`, `.bmp`, `.tif`, `.tiff`, `.avif`

Videos:
- `.mp4`, `.webm`, `.mov`, `.m4v`, `.ogv`, `.ogg`

## Required Args

- `--root <dir>`: root directory to scan recursively
- `--namespace <name>`: target namespace for upload

## Main Options

- `--api-base <url>`: API base URL (default `http://localhost:3000`)
- `--checkpoint-file <path>`: override checkpoint path (shared cache across roots)
- `--folder <name>`: optional folder value sent to upload API
- `--tags <csv>`: base tags for all files
- `--append-image-tag <tag>`: optional final image tag appended after AI tags
- `--description-prefix <txt>`: prefix in generated description
- `--include-filename`: include filename in description
- `--include-path-tags`: add subdirectory components as tags
- `--ai-metadata`: image AI display name + AI tags
- `--ai-display-name`: image AI display name only
- `--ai-tags`: image AI tags only
- `--tag-count <n>`: AI tag target count
- `--concurrency <n>`: worker parallelism
- `--throttle-ms <n>`: global min interval between upload attempts
- `--on-duplicate <mode>`: image duplicate handling (`reject` or `family`)
- `--limit <n>`: stop after first N matching files
- `--dry-run`: print plan, no upload
- `--verbose`: detailed logs
- `--hash-cache-backfill-only`: no upload; only backfill hash cache entries
- `--assume-uploaded`: with backfill-only, seed unknown files as uploaded

## Caching Model

`fs:ingest` now uses two cache layers in checkpoint JSON:

1. Path cache (`entries`)
- Key: relative path from `--root`
- Match fields: `status=uploaded`, `signature=size:mtime`, `kind`, `namespace`
- Fast skip for unchanged files in the same tree

2. Hash cache (`hashEntries`)
- Key: `namespace + kind + sha256(content)`
- Path-independent skip for moved/renamed files
- Enables shared-cache behavior across different roots

Default checkpoint location:
- `data/fs-ingest-checkpoints/<sha1(root+namespace)>.json`

Override for shared cache:
- `--checkpoint-file /absolute/path/to/shared.json`

## Duplicate Behavior (`409`)

If upload is attempted and server responds duplicate:
- logs `skip(duplicate)`
- writes checkpoint entries (path + hash when available)
- future runs can skip earlier (local cache hit)

## Backfill Modes

### Safe backfill

Use when you only want to convert already-known path cache entries into hash cache entries:

```bash
npm run fs:ingest -- \
  --root "/path/to/files" \
  --namespace cf-default \
  --checkpoint-file "/path/to/shared.json" \
  --hash-cache-backfill-only \
  --verbose
```

This does **not** mark unknown files as uploaded.

### Trust backfill (`--assume-uploaded`)

Use only if you are confident files are already uploaded and want to seed cache without server checks:

```bash
npm run fs:ingest -- \
  --root "/path/to/files" \
  --namespace cf-default \
  --checkpoint-file "/path/to/shared.json" \
  --hash-cache-backfill-only \
  --assume-uploaded \
  --verbose
```

This mode:
- does not upload
- does not call AI metadata
- seeds missing path/hash cache entries as uploaded

## Usage Examples

### 1) Basic ingest

```bash
npm run fs:ingest -- \
  --root "/Users/julian/Code/chester-downloads-discord-images/images/🦌-images-only-visually-inspiring_965624155473063976/images" \
  --namespace cf-default
```

### 2) AI metadata + controlled upload rate

```bash
npm run fs:ingest -- \
  --root "/path/to/images" \
  --namespace cf-default \
  --ai-metadata \
  --tag-count 3 \
  --throttle-ms 2000 \
  --on-duplicate family \
  --concurrency 2 \
  --verbose
```

### 3) Add fixed image tag + base tags

```bash
npm run fs:ingest -- \
  --root "/path/to/images" \
  --namespace cf-default \
  --tags "discord,nfl-discord" \
  --append-image-tag "campaign-2026" \
  --ai-tags
```

### 4) Dry run audit

```bash
npm run fs:ingest -- \
  --root "/path/to/images" \
  --namespace cf-default \
  --ai-metadata \
  --dry-run \
  --verbose
```

### 5) Shared cache across roots

```bash
npm run fs:ingest -- \
  --root "/mnt/set-a" \
  --namespace cf-default \
  --checkpoint-file "/Users/julian/Code/cloud-flare-image-handler/data/fs-ingest-checkpoints/discord-shared-cf-default.json" \
  --ai-metadata
```

```bash
npm run fs:ingest -- \
  --root "/Volumes/archive/set-a-copy" \
  --namespace cf-default \
  --checkpoint-file "/Users/julian/Code/cloud-flare-image-handler/data/fs-ingest-checkpoints/discord-shared-cf-default.json" \
  --ai-metadata
```

### 6) Hash-cache warmup before cross-root ingest

```bash
npm run fs:ingest -- \
  --root "/path/with-known-checkpoint-history" \
  --namespace cf-default \
  --checkpoint-file "/Users/julian/Code/cloud-flare-image-handler/data/fs-ingest-checkpoints/discord-shared-cf-default.json" \
  --hash-cache-backfill-only
```

### 7) Fast confidence run on first N files

```bash
npm run fs:ingest -- \
  --root "/path/to/images" \
  --namespace cf-default \
  --limit 25 \
  --verbose
```

## Logging and Diagnostics

Common log outcomes:
- `skip(cached)`: path cache hit
- `skip(cached-hash)`: hash cache hit
- `skip(duplicate)`: server duplicate response after upload attempt
- `ok`: successful upload
- `fail`: non-duplicate upload failure

When `--on-duplicate family` is used, same-namespace content-hash duplicates are uploaded as child variants under the oldest matched canonical parent instead of producing `skip(duplicate)`.

Arg errors are strict:
- unknown options fail (namespace typos are called out)
- missing option values fail

## Common Pitfalls

1. Path newline splitting in shell commands
- Keep quoted paths on one line.

2. Namespace typos
- Must be `--namespace`, not misspellings.

3. Expecting local cache to equal server truth
- Local cache is checkpoint-driven.
- Use shared checkpoint and hash cache to improve cross-root behavior.

4. Using a fresh checkpoint file
- A new checkpoint has no prior upload knowledge.

## Shortcut Workflow Script

This repo includes:
- `scripts/discord-refresh-and-fs-ingest.sh`
- npm alias: `npm run fs:ingest:discord-refresh-all -- <args>`

It can:
1. Run `find_last_ids_per_channel.py`
2. Run `download_images_from_discord_channel.py`
3. Run `fs:ingest` for each channel subdirectory under Discord images root

The Discord wrapper defaults to `--on-duplicate family`.

Example:

```bash
npm run fs:ingest:discord-refresh-all -- \
  --namespace cf-default \
  --checkpoint-file "/Users/julian/Code/cloud-flare-image-handler/data/fs-ingest-checkpoints/discord-shared-cf-default.json" \
  --tags "discord,nfl-discord" \
  --append-image-tag "discord-archive" \
  --on-duplicate family \
  --verbose
```

Backfill-only across all channel subdirs:

```bash
npm run fs:ingest:discord-refresh-all -- \
  --skip-discord-refresh \
  --namespace cf-default \
  --checkpoint-file "/Users/julian/Code/cloud-flare-image-handler/data/fs-ingest-checkpoints/discord-shared-cf-default.json" \
  --hash-cache-backfill-only \
  --assume-uploaded
```
