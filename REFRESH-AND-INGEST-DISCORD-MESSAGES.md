# **Refresh and Ingest Discord Messages into Photarium**

This document defines the workflow for **downloading latest Discord content** and **ingesting it into the Photarium catalog**.

## **What this does**

- Runs a Discord refresh script from a local Discord image repo to fetch latest channel content.
- Runs `fs:ingest` over each channel folder.
- Uploads to Photarium catalog via:
  - `POST /api/upload/external` for images.
  - `POST /api/import/page/upload-video` for videos.

## **Primary script**

- `scripts/discord-refresh-and-fs-ingest.sh`
- NPM entry point: `npm run fs:ingest:discord-refresh-all`

## **Recommended one-shot run (default settings)**

```bash
npm run fs:ingest:discord-refresh-all
```

This runs:

- **Refresh step**: updates channel IDs and downloads latest content in the Discord repo
  - `find_last_ids_per_channel.py`
  - `download_images_from_discord_channel.py`
- **Ingest step**: calls `npm run fs:ingest` per channel folder
- Default duplicate handling for this Discord runner is `--on-duplicate family`

## **Manual control**

### **Run only ingest (skip download)**

```bash
npm run fs:ingest:discord-refresh-all -- --skip-discord-refresh
```

### **Fast incremental mode**

```bash
npm run fs:ingest:discord-refresh-incremental
```

This uses:

- `--skip-discord-refresh` (no download step)
- `--no-ai-metadata` (skip AI metadata pass)
- `--report-cache` (print checkpoint hit ratio first)
- high concurrency with no global throttle (`--concurrency 8 --throttle-ms 0`)

### **Run only refresh (skip ingest)**

```bash
npm run fs:ingest:discord-refresh-all -- --skip-ingest
```

### **Dry run (no uploads)**

```bash
npm run fs:ingest:discord-refresh-all -- --dry-run
```

### **Verbose mode**

```bash
npm run fs:ingest:discord-refresh-all -- --verbose
```

## **Common useful flags**

- `--discord-repo <path>`
- `--images-root <path>`
- `--namespace <name>`
- `--visually-namespace <name>`
- `--autotrader-namespace <n>`
- `--api-base <url>`
- `--checkpoint-file <path>`
- `--tags <csv>` (default: `discord,nfl-discord`)
- `--tag-count <n>`
- `--concurrency <n>`
- `--throttle-ms <n>`
- `--append-image-tag <tag>`
- `--description-prefix <text>`
- `--include-path-tags`
- `--include-filename`
- `--no-ai-metadata`
- `--on-duplicate <reject|family>`
- `--report-cache`

## **Checkpoint health check**

When a run feels slow, use `--report-cache` to print a preflight checkpoint report before any uploads:

```bash
npm run fs:ingest:discord-refresh-all -- --skip-discord-refresh --report-cache
```

Look for:
- `pathHits` (exact file-path + namespace signature match)
- `hashHits` (no exact path match, but content-hash match)
- `misses` (not already represented in cache)
- `hitRate` / `missRate` (exact preflight ratio)

## **Example with overrides**

```bash
npm run fs:ingest:discord-refresh-all -- \
  --discord-repo /Users/julian/Code/chester-downloads-discord-images \
  --namespace cf-midjourney \
  --visually-namespace cf-default \
  --autotrader-namespace cf-autotrader \
  --tags discord,nfl-discord,midjourney \
  --description-prefix "Discord media refresh" \
  --on-duplicate family \
  --concurrency 4 \
  --throttle-ms 1500
  --report-cache
```

## **Implementation reference**

- Orchestrator: `scripts/discord-refresh-and-fs-ingest.sh`
- Ingest engine: `scripts/fs-ingest.mjs`
- Script hook: `npm run fs:ingest:discord-refresh-all`
