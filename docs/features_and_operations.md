# Photarium: Features & Operations Guide

Comprehensive documentation for all Photarium capabilities and operational procedures.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Uploading Images](#uploading-images)
4. [Search & Discovery](#search--discovery)
5. [Search Exclusion Tags](#search-exclusion-tags)
6. [Gallery CLI Commands](#gallery-cli-commands)
7. [Image Detail Features](#image-detail-features)
8. [Metadata Storage](#metadata-storage)
9. [Embeddings & Vector Search](#embeddings--vector-search)
10. [Backup & Restore](#backup--restore)
11. [Scripts Reference](#scripts-reference)
12. [API Reference](#api-reference)

---

## Overview

**Photarium** is a self-hosted image management application built on:
- **Next.js** (React framework)
- **Cloudflare Images** (storage, CDN delivery, variants)
- **Redis Stack** (vector search, embeddings, caching)

Key capabilities:
- Upload single images, batches, or ZIP archives
- Semantic search ("find sunset photos")
- Color-based search ("find blue images")
- Find similar/opposite images
- AI-generated alt text and descriptions
- Namespace isolation for multi-project setups
- Image variants (thumbnail, medium, large, public)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Photarium                             │
├─────────────────────────────────────────────────────────────┤
│  Next.js App (localhost:3000)                               │
│  ├── /api/* routes (REST API)                               │
│  ├── /images/[id] (detail pages)                            │
│  └── Gallery UI (React components)                          │
├─────────────────────────────────────────────────────────────┤
│                    Data Storage                              │
│  ┌──────────────────────┐  ┌────────────────────────────┐  │
│  │   Cloudflare Images   │  │      Redis Stack           │  │
│  │   ────────────────    │  │      ───────────           │  │
│  │   • Image files       │  │   • CLIP embeddings (512d) │  │
│  │   • Image metadata    │  │   • Color embeddings       │  │
│  │   • Variants          │  │   • Vector indexes         │  │
│  │   • Tags, folders     │  │   • Image cache            │  │
│  │   • Alt text          │  │   • Hash cache             │  │
│  └──────────────────────┘  └────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Data Distribution

| Data Type | Storage Location | Persistence |
|-----------|------------------|-------------|
| Original image files | Cloudflare Images | Permanent |
| Image metadata (title, alt, tags, folder) | Cloudflare Images | Permanent |
| Namespace | Cloudflare Images metadata | Permanent |
| CLIP embeddings (512-dimensional) | Redis Stack | Requires backup |
| Color embeddings | Redis Stack | Requires backup |
| Vector search indexes | Redis Stack | Rebuilt on startup |
| Image cache | Redis Stack | Ephemeral |

---

## Uploading Images

### Supported Methods

1. **Drag & Drop** — Drop images directly into the upload area
2. **File Browser** — Click to select files
3. **URL Import** — Fetch images from URLs
4. **Page Scan** — Scan a webpage and import all images
5. **ZIP Archives** — Upload a `.zip` file to batch-import images
6. **Animated WebP** — Combine multiple images into an animation

### Page Scan (Importing from Web Pages)

Enter a webpage URL to scan for images:

**Standard Mode (Fast):**
- Fetches HTML and extracts `<img>` tags
- Fast but may miss JavaScript-loaded content
- Best for static pages with visible images

**Scroll Mode (For Infinite Scroll):**
- Uses a headless browser (Puppeteer) to load the page
- Scrolls down automatically to trigger lazy loading
- Captures images that load dynamically
- Configurable max scroll count (1-50)
- Slower but more thorough

**Setup for Scroll Mode:**
```bash
# Install puppeteer (optional, only needed for scroll mode)
npm install puppeteer
```

**Options:**
- **Scroll mode** — Enable headless browser with auto-scroll
- **Max scrolls** — Number of times to scroll down (default: 10)
- **Allow insecure TLS** — Accept expired/self-signed certificates

**Environment variables:**
- `IMPORT_ALLOW_INSECURE_TLS=true` — Enable insecure TLS option
- `IMPORT_SCROLL_MAX_SCROLLS=10` — Default max scroll count
- `IMPORT_SCROLL_TIMEOUT_MS=30000` — Page load timeout

### ZIP File Upload

Drag a `.zip` file into the upload area to extract and upload all images:

- Supported image formats inside ZIP: JPEG, PNG, WebP, GIF
- Each image is uploaded individually to Cloudflare
- Original filenames are preserved
- Images are tagged with `zip` automatically
- Folder and additional tags can be set before upload

### Creating Animated WebP Images

Combine multiple images into a single animated WebP file:

**Prerequisites:**
- ffmpeg must be installed (`brew install ffmpeg` on macOS)

**Steps:**

1. Add multiple images to the upload queue (drag & drop or import)
2. Select the images to include using the checkboxes
3. Configure animation settings:
   - **FPS** — Frames per second (default: 1, lower = slower animation)
   - **Loop** — Whether the animation loops continuously
   - **Output name** — Filename for the generated animation
4. Click **"Create animated WebP"**
5. The server combines frames using ffmpeg and returns the animated file
6. The animation is added to your queue for upload

**Tips:**
- Images are combined in queue order — drag to reorder if needed
- Use low FPS (0.5-2) for slideshow-style animations
- Use higher FPS (10-30) for smooth motion
- All images should ideally be the same dimensions
- Requires at least 2 selected images

**Example use cases:**
- Product image carousels
- Before/after comparisons
- Step-by-step tutorials
- GIF alternatives with better compression

### Metadata Assignment

When uploading, you can set:
- **Folder** — Organizational grouping
- **Tags** — Comma-separated labels
- **Namespace** — Project isolation (defaults to env setting)

### Upload Processing

1. Images are resized client-side if over 10MB
2. File is uploaded to Cloudflare Images
3. Cloudflare generates variants (thumbnail, medium, large, public)
4. Metadata is stored in Cloudflare
5. (Async) CLIP and color embeddings are generated
6. Embeddings are stored in Redis

---

## Search & Discovery

### Text Search (Semantic)

Search for images by describing what you're looking for:

```bash
# API
curl -X POST http://localhost:3000/api/images/search \
  -H "Content-Type: application/json" \
  -d '{"type":"text","query":"dog playing in snow","limit":24}'
```

Examples:
- "sunset on beach"
- "people smiling"
- "vintage car"
- "modern architecture"

### Color Search

Find images by dominant color:

```bash
# API
curl -X POST http://localhost:3000/api/images/search \
  -H "Content-Type: application/json" \
  -d '{"type":"color","query":"#3B82F6","limit":24}'
```

Supported formats:
- Hex: `#3B82F6`, `#F00`
- RGB: `rgb(59, 130, 246)`

### Similar Images

Find images visually or semantically similar to a reference:

```bash
# CLIP-based similarity (semantic)
curl http://localhost:3000/api/images/{id}/similar?type=clip&limit=12

# Color-based similarity
curl http://localhost:3000/api/images/{id}/similar?type=color&limit=12
```

### Antipode Search

Find images that are semantically or visually **opposite**:

```bash
# CLIP antipodes (semantic opposites)
curl -X POST http://localhost:3000/api/images/{id}/antipode \
  -H "Content-Type: application/json" \
  -d '{"type":"clip","limit":8}'

# Color antipodes (complementary colors)
curl -X POST http://localhost:3000/api/images/{id}/antipode \
  -H "Content-Type: application/json" \
  -d '{"type":"color","limit":8}'
```

### UI Components

- **Semantic Cluster** — Shows similar images on detail page
- **Antipode Search** — Shows opposite images with toggle for CLIP/color

---

## Search Exclusion Tags

Exclude specific images from search results using special tags.

### Available Tags

| Tag | Effect | Use Case |
|-----|--------|----------|
| `x-clip` | Exclude from CLIP/semantic search | Hide from "find similar" |
| `x-color` | Exclude from color search | Hide from color-based queries |
| `x-search` | Exclude from ALL vector searches | Complete search exclusion |

### How to Apply

**Via UI:**
1. Open image detail page
2. Scroll to "Search Exclusions" section
3. Toggle the desired exclusion(s)

**Via API:**
```bash
# Add x-clip tag
curl -X PATCH http://localhost:3000/api/images/{id}/update \
  -H "Content-Type: application/json" \
  -d '{"tags":["existing-tag","x-clip"]}'
```

### Tag Behavior

```
x-clip
  └── Image excluded from:
      • Text search ("find sunset photos")
      • Similar images (CLIP mode)
      • Antipode search (CLIP mode)

x-color
  └── Image excluded from:
      • Color search (hex queries)
      • Similar images (color mode)
      • Antipode search (color mode)

x-search
  └── Image excluded from:
      • ALL of the above
      • Any future vector search types
```

### Implementation

Tags are stored in Cloudflare metadata and checked at query time:

```typescript
// From src/utils/searchExclusion.ts
export const EXCLUDE_CLIP_TAG = 'x-clip';
export const EXCLUDE_COLOR_TAG = 'x-color';
export const EXCLUDE_ALL_SEARCH_TAG = 'x-search';

function shouldExcludeFromCLIP(tags: string[]): boolean {
  return tags.some(tag => 
    tag === EXCLUDE_CLIP_TAG || 
    tag === EXCLUDE_ALL_SEARCH_TAG
  );
}
```

---

## Gallery CLI Commands

The gallery includes a command bar for power-user operations. Type `help` to see all commands.

### Folder Commands

```
hide folder <name>        Hide a folder from gallery view
show folder <name>        Show a hidden folder (or filter to it)
unhide folder <name>      Restore a hidden folder
list hidden folders       Show currently hidden folders
list folders              Show all known folders
show only folders <a,b>   Hide all folders except listed ones
clear hidden              Unhide all folders
```

### Tag Commands

```
hide tag <name>           Hide a tag from gallery view
show tag <name>           Filter gallery to a specific tag
unhide tag <name>         Restore a hidden tag
list hidden tags          Show currently hidden tags
list tags                 Show all known tags
show only tags <a,b>      Hide all tags except listed ones
clear tag                 Remove tag filter
clear hidden tags         Unhide all tags
```

### Embedding Filter Commands

Filter images by embedding status (useful for backfill monitoring):

```
show missing clip         Show images without CLIP embeddings
show missing color        Show images without color embeddings
show missing embeddings   Show images missing any embedding
clear embedding filter    Remove embedding filter
```

Aliases:
- `missing clip`, `no clip` → same as `show missing clip`
- `missing color`, `no color` → same as `show missing color`
- `missing embeddings`, `no embeddings` → same as `show missing embeddings`

### View Commands

```
parents only              Show only images that have variants
show all                  Show all images including solos
```

### Pagination Commands

```
page next                 Go to next page
page prev                 Go to previous page
page <n>                  Jump to page number
```

---

## Image Detail Features

### Metadata Editing

Edit on the detail page (`/images/{id}`):
- **Title** — Display name
- **Alt Text** — Accessibility description
- **Description** — Longer description
- **Folder** — Organizational grouping
- **Tags** — Comma-separated labels
- **Namespace** — Project isolation

### AI Generation

- **Generate Alt Text** — Uses GPT-4o mini to describe the image
- **Generate Description** — Creates a detailed narrative description
- **Generate Haiku** — Creates a poetic haiku about the image
- **Extract Concepts** — Lists key concepts/objects in the image

### Variants

Assign images as variants of a parent:
- **Thumbnail** — Small preview version
- **Social Share** — Open Graph / social media
- **Custom variants** — Any named variant

### Semantic Cluster

Shows the 8 most similar images by:
- CLIP embeddings (semantic similarity)
- Color embeddings (visual similarity)

### Antipode Search

Shows the 8 most **dissimilar** images:
- CLIP mode: Semantically opposite content
- Color mode: Complementary/contrasting colors

### Search Exclusions

Toggle exclusion from searches:
- **Semantic** — Exclude from CLIP searches
- **Color** — Exclude from color searches
- **All Search** — Exclude from all vector searches

---

## Metadata Storage

### Cloudflare Images Metadata

Stored permanently with the image:

```typescript
interface CloudflareMetadata {
  filename: string;
  displayName?: string;
  altText?: string;
  description?: string;
  folder?: string;
  tags?: string[];            // Including x-clip, x-color, x-search
  namespace?: string;
  originalUrl?: string;
  sourceUrl?: string;
  uploadedAt?: string;
  // EXIF data preserved
}
```

Access via Cloudflare API or Photarium API:
```bash
curl http://localhost:3000/api/images/{id}
```

### Redis Embeddings

Stored in Redis Stack with vector indexes:

```
image:{id}
  ├── clipEmbedding: [512 float values]
  ├── colorEmbedding: {
  │     dominantColors: [[r,g,b], ...],
  │     avgColor: [r,g,b],
  │     histogram: [64 values]
  │   }
  └── embeddedAt: timestamp
```

Vector indexes:
- `idx:clip` — CLIP embedding search (cosine similarity)
- `idx:color` — Color embedding search

---

## Embeddings & Vector Search

### Embedding Types

| Type | Dimensions | Purpose | Generation |
|------|-----------|---------|------------|
| CLIP | 512 | Semantic search, text queries | HuggingFace API or local Python |
| Color histogram | 64 | Color matching | Local JavaScript |
| Average color | 3 (RGB) | Quick color filter | Local JavaScript |
| Dominant colors | 5×3 | Palette matching | Local JavaScript |

### Generating Embeddings

**Automatic:** Embeddings are generated when images are uploaded.

**Backfill existing images:**
```bash
# Process all images
node scripts/backfill-embeddings.mjs

# Process specific namespace
node scripts/backfill-embeddings.mjs --namespace=my-project

# CLIP only, limit 50
node scripts/backfill-embeddings.mjs --clip-only --limit=50

# Dry run to see what would be processed
node scripts/backfill-embeddings.mjs --dry-run
```

### Backfill Script Options

```
--namespace=<ns>  Only process images in this namespace
--limit=<n>       Maximum images to process
--batch=<n>       Batch size before pause (default: 10)
--delay=<ms>      Delay between batches (default: 1000)
--clip-only       Only generate CLIP embeddings
--color-only      Only generate color embeddings
--force           Regenerate even if embeddings exist
--dry-run         Show what would be processed
-v                Verbose output
-vv               Request/response details
-vvv              Full API responses
```

### Embedding Providers

Configure in `.env.local`:

```bash
# HuggingFace (default, recommended)
EMBEDDING_PROVIDER=huggingface
HUGGINGFACE_API_TOKEN=hf_xxxxx

# Local Python (requires CLIP model)
EMBEDDING_PROVIDER=local
PYTHON_EXECUTABLE=python3
```

---

## Backup & Restore

### What Needs Backup

| Component | Backup Method | Frequency |
|-----------|--------------|-----------|
| Cloudflare Images | N/A (managed service) | Automatic |
| Redis embeddings | `backup-redis.sh` | Daily recommended |
| `.env.local` | Manual copy | After changes |

### Redis Backup Script

```bash
# Basic backup
./scripts/backup-redis.sh

# Keep only last 5 backups
./scripts/backup-redis.sh --keep=5

# Custom directory
./scripts/backup-redis.sh --dir=/path/to/backups

# Dry run
./scripts/backup-redis.sh --dry-run
```

**Options:**
```
--dir=<path>       Backup directory (default: ./backups/redis)
--keep=<n>         Number of backups to keep (default: 10)
--container=<name> Container name (default: photarium-redis)
--quiet            Suppress output except errors
--dry-run          Show what would be done
```

### Scheduled Backups

**macOS (launchd):**

Create `~/Library/LaunchAgents/com.photarium.redis-backup.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.photarium.redis-backup</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Users/julian/Code/cloud-flare-image-handler/scripts/backup-redis.sh</string>
        <string>--quiet</string>
    </array>
    <key>StartCalendarInterval</key>
    <array>
        <dict><key>Hour</key><integer>0</integer></dict>
        <dict><key>Hour</key><integer>6</integer></dict>
        <dict><key>Hour</key><integer>12</integer></dict>
        <dict><key>Hour</key><integer>18</integer></dict>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/julian/Code/cloud-flare-image-handler</string>
</dict>
</plist>
```

Load:
```bash
launchctl load ~/Library/LaunchAgents/com.photarium.redis-backup.plist
```

**Linux (cron):**
```bash
# Every 6 hours
0 */6 * * * cd /path/to/photarium && ./scripts/backup-redis.sh --quiet
```

### Restore from Backup

```bash
# Stop the Redis container
docker stop photarium-redis

# Copy backup into container
docker cp ./backups/redis/redis-backup-YYYYMMDD-HHMMSS.rdb photarium-redis:/data/dump.rdb

# Restart container
docker start photarium-redis

# Verify
curl http://localhost:3000/api/images/embeddings/status
```

### Cloud Backup (Recommended)

Sync backups to cloud storage:

```bash
# AWS S3
aws s3 sync ./backups/redis s3://my-bucket/photarium-backups/

# Google Cloud Storage
gsutil rsync -r ./backups/redis gs://my-bucket/photarium-backups/

# Backblaze B2
b2 sync ./backups/redis b2://my-bucket/photarium-backups/
```

---

## Scripts Reference

### Embedding Scripts

| Script | Purpose |
|--------|---------|
| `backfill-embeddings.mjs` | Generate CLIP/color embeddings for existing images |
| `generate-embeddings.mjs` | Generate embeddings for specific images |
| `clip_embed.py` | Python CLIP embedding generator (local mode) |

### Maintenance Scripts

| Script | Purpose |
|--------|---------|
| `backup-redis.sh` | Backup Redis data with rotation |
| `cleanup-orphaned-redis.mjs` | Remove Redis entries for deleted images |
| `refresh-hash-cache.mjs` | Rebuild duplicate detection hash cache |

### Utility Scripts

| Script | Purpose |
|--------|---------|
| `audit-broken-images.mjs` | Find images with missing/broken files |
| `backfill-namespace.mjs` | Add namespace to images missing it |
| `count-folder-images.mjs` | Count images per folder |
| `diagnose-duplicates.mjs` | Analyze duplicate detection |
| `scan-namespaces.mjs` | List all namespaces in use |
| `watch-drop-off.mjs` | Monitor a folder and auto-upload new images |

---

## API Reference

### Images

```
GET    /api/images                    List images (paginated)
GET    /api/images/{id}               Get image details
PATCH  /api/images/{id}/update        Update metadata
DELETE /api/images/{id}               Delete image
```

### Search

```
POST   /api/images/search             Unified search endpoint
  body: { type: 'text'|'color'|'image', query: string, limit?: number }

GET    /api/images/{id}/similar       Find similar images
  query: type=clip|color, limit=number

POST   /api/images/{id}/antipode      Find opposite images
  body: { type: 'clip'|'color', limit?: number }
```

### Embeddings

```
GET    /api/images/embeddings/status  Check embedding coverage
POST   /api/images/{id}/embeddings    Generate embeddings for one image
  body: { types: ['clip', 'color'] }
```

### AI Generation

```
POST   /api/images/{id}/alt           Generate alt text
POST   /api/images/{id}/description   Generate description
GET    /api/images/{id}/haiku         Generate haiku
GET    /api/images/{id}/concepts      Extract concepts
```

### Upload

```
POST   /api/upload                    Upload image (multipart form)
POST   /api/upload/external           Upload from URL
POST   /api/import/page              Scan page for images
```

### Folders & Namespaces

```
GET    /api/folders                   List folders
GET    /api/namespaces                List namespaces
```

---

## Environment Variables

### Required

```bash
CLOUDFLARE_ACCOUNT_ID=abc123
CLOUDFLARE_API_TOKEN=your_token
NEXT_PUBLIC_CLOUDFLARE_ACCOUNT_HASH=your_hash
```

### Optional

```bash
# Namespace (project isolation)
IMAGE_NAMESPACE=my-project
NEXT_PUBLIC_IMAGE_NAMESPACE=my-project

# AI Features
OPENAI_API_KEY=sk-xxxxx

# Embeddings
EMBEDDING_PROVIDER=huggingface    # or 'local'
HUGGINGFACE_API_TOKEN=hf_xxxxx
PYTHON_EXECUTABLE=python3         # for local CLIP

# Redis
CACHE_STORAGE_TYPE=redis
REDIS_URL=redis://localhost:6379

# Search
NEXT_PUBLIC_SEARCH_LIMIT=48       # max results
NEXT_PUBLIC_SEARCH_PAGE_SIZE=12   # results per page
```

---

## Troubleshooting

### Vector search not working

1. Check Redis is running: `docker ps | grep redis`
2. Check Redis has data: `docker exec photarium-redis redis-cli DBSIZE`
3. Check indexes exist: `docker exec photarium-redis redis-cli FT._LIST`
4. Verify embeddings: `curl http://localhost:3000/api/images/embeddings/status`

### Embeddings not generating

1. Check provider config in `.env.local`
2. For HuggingFace: verify `HUGGINGFACE_API_TOKEN`
3. For local: verify Python venv and CLIP model installed
4. Check logs: `npm run dev` output

### Search returns no results

1. Verify images have embeddings (check detail page)
2. Check for `x-clip` or `x-search` tags excluding images
3. Try broader search terms
4. Verify Redis connection

### Backup issues

1. Ensure container name is correct (`photarium-redis`)
2. Check Docker is running
3. Verify backup directory exists and is writable
4. Check disk space

---

## See Also

- [Installation Guide](../INSTALLATION.md)
- [External Upload API](../EXTERNAL_UPLOAD_API.md)
- [Redis Backup Guide](./redis-backup.md)
- [Namespace Documentation](./namespace.md)
- [Variants Documentation](./variants.md)
