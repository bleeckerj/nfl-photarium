# Cloudflare Image Handler - Headless API Reference

This document describes the complete REST API surface for integrating with the Cloudflare Image Handler in "headless" mode—without the web UI.

## Base URL

```
http://localhost:3000/api
```

Replace with your deployment URL for production use.

---

## Authentication

The API does not include built-in authentication. If exposing externally, protect endpoints via reverse proxy (API keys, Basic Auth, etc.).

---

## Table of Contents

- [Cloudflare Image Handler - Headless API Reference](#cloudflare-image-handler---headless-api-reference)
  - [Base URL](#base-url)
  - [Authentication](#authentication)
  - [Table of Contents](#table-of-contents)
  - [Images](#images)
    - [List Images](#list-images)
    - [Get Single Image](#get-single-image)
    - [Update Image Metadata](#update-image-metadata)
    - [Delete Image](#delete-image)
    - [Share/Redirect to Image](#shareredirect-to-image)
  - [Upload](#upload)
    - [Upload Image (Internal)](#upload-image-internal)
    - [Upload Image (External API)](#upload-image-external-api)
    - [Upload Video (Page Import)](#upload-video-page-import)
    - [Import from URL](#import-from-url)
  - [Paginated Uploads](#paginated-uploads)
  - [Folders](#folders)
    - [List Folders](#list-folders)
    - [Create Folder](#create-folder)
    - [Rename Folder](#rename-folder)
    - [Delete Folder](#delete-folder)
  - [Namespaces](#namespaces)
  - [Search](#search)
    - [Semantic/Vector Search](#semanticvector-search)
    - [Similar Images](#similar-images)
    - [Antipode (Opposite) Search](#antipode-opposite-search)
  - [Colors](#colors)
  - [Embeddings](#embeddings)
    - [Generate Embeddings (Single)](#generate-embeddings-single)
    - [Generate Embeddings (Batch)](#generate-embeddings-batch)
    - [Vector Status](#vector-status)
  - [AI-Powered Features](#ai-powered-features)
    - [Generate ALT Text](#generate-alt-text)
    - [Generate Description](#generate-description)
    - [Generate Prompt (PromptThis)](#generate-prompt-promptthis)
    - [Concept Radar](#concept-radar)
    - [Generate Haiku](#generate-haiku)
    - [Batch Prompts Lookup](#batch-prompts-lookup)
  - [Image Manipulation](#image-manipulation)
    - [Rotate Image](#rotate-image)
    - [Create Animation](#create-animation)
    - [Animate Selection](#animate-selection)
    - [Video to Animated WebP](#video-to-animated-webp)
  - [Image Family Management](#image-family-management)
    - [Delete Family](#delete-family)
    - [Swap Parent](#swap-parent)
    - [Job Status (Delete Family)](#job-status-delete-family)
  - [Extras (Extended Metadata)](#extras-extended-metadata)
    - [Get Extras](#get-extras)
    - [Update Extras](#update-extras)
  - [Backup](#backup)
    - [List Backups](#list-backups)
    - [Create Backup](#create-backup)
  - [Audit](#audit)
  - [Debug](#debug)
  - [Error Responses](#error-responses)
  - [Environment Variables](#environment-variables)
  - [Rate Limiting \& Best Practices](#rate-limiting--best-practices)
  - [SDK Example (TypeScript)](#sdk-example-typescript)

---

## Images

### List Images

Retrieve all images with optional filtering.

```
GET /api/images
```

**Query Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `refresh` | `"1"` | Force cache refresh |
| `namespace` | string | Filter by namespace. Use `__all__` for all, `__none__` for no namespace |
| `aspectRatioClass` | `"square"` \| `"horizontal"` \| `"vertical"` | Filter by aspect ratio class |
| `aspectRatio` | string | Filter by exact aspect ratio (e.g., `"16:9"`) |
| `mediaFilter` | `"animated"` | Return only motion-oriented assets: videos plus explicit animated-WebP image derivatives |

**Response:**

```json
{
  "images": [
    {
      "id": "58f27351-...-f498",
      "filename": "example.jpg",
      "uploaded": "2025-12-05T21:59:41.036Z",
      "folder": "my-folder",
      "tags": ["tag1", "tag2"],
      "description": "Image description",
      "originalUrl": "/images/source/path",
      "sourceUrl": "https://example.com/page",
      "namespace": "app-a",
      "altTag": "Alt text for accessibility",
      "parentId": null,
      "hasClipEmbedding": true,
      "hasColorEmbedding": true,
      "dominantColors": ["#FF5733", "#33FF57"],
      "averageColor": "#888888",
      "aspectRatio": "16:9",
      "dimensions": { "width": 1920, "height": 1080 },
      "variants": [
        "https://imagedelivery.net/<hash>/<id>/public",
        "https://imagedelivery.net/<hash>/<id>/w=300?format=webp"
      ]
    }
  ],
  "cache": { "lastFetched": 1733438400000, "ttlMs": 300000 },
  "namespace": "app-a"
}
```

---

### Get Single Image

```
GET /api/images/{id}
```

**Response:**

```json
{
  "image": { /* same structure as list response */ }
}
```

---

### Update Image Metadata

```
PATCH /api/images/{id}/update
```

**Request Body (JSON):**

| Field | Type | Description |
|-------|------|-------------|
| `folder` | string | Folder name |
| `tags` | string[] \| string | Array or comma-separated tags |
| `description` | string \| null | Description text (null to clear) |
| `originalUrl` | string | Original source path |
| `sourceUrl` | string | Page URL where found |
| `displayName` | string | Display name |
| `altTag` | string | Accessibility alt text |
| `namespace` | string | Namespace identifier |
| `parentId` | string | Link as variant of another image |
| `variationSort` | number | Sort order for variants |
| `clearExif` | boolean | Remove EXIF metadata |

**Response:**

```json
{
  "id": "58f27351-...-f498",
  "filename": "example.jpg",
  "url": "https://imagedelivery.net/...",
  "variants": [...],
  "folder": "updated-folder",
  "tags": ["new", "tags"]
}
```

---

### Delete Image

```
DELETE /api/images/{id}
```

**Response:**

```json
{ "success": true }
```

---

### Share/Redirect to Image

Redirects to the Cloudflare CDN URL for easy sharing.

```
GET /api/images/{id}/share?variant=large
```

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `variant` | string | `"large"` | Variant name (`public`, `small`, `medium`, `large`, `thumbnail`) |

**Response:** 307 redirect to CDN URL

---

## Upload

### Upload Image (Internal)

Upload via multipart form data. Supports single images, ZIP archives, and Keynote files.

```
POST /api/upload
Content-Type: multipart/form-data
```

**Form Fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `file` | ✅ | Image file (max 10MB) or ZIP/Keynote archive (max 500MB) |
| `folder` | ❌ | Target folder |
| `tags` | ❌ | Comma-separated tags |
| `description` | ❌ | Description text |
| `originalUrl` | ❌ | Source path reference |
| `sourceUrl` | ❌ | Page URL reference |
| `namespace` | ❌ | Namespace (defaults to `IMAGE_NAMESPACE` env var) |
| `parentId` | ❌ | Parent image ID for variants |
| `duplicateAction` | ❌ | `reject` (default) or `family` to admit same-namespace content-hash duplicates as child variants of an existing canonical parent |

**Response:**

```json
{
  "id": "abc123",
  "filename": "photo.png",
  "url": "https://imagedelivery.net/<hash>/abc123/public",
  "variants": ["…/public", "…/thumbnail"],
  "uploaded": "2025-11-28T17:05:12.345Z",
  "folder": "my-folder",
  "tags": ["tag1", "tag2"],
  "description": "Description",
  "namespace": "app-a"
}
```

---

### Upload Image (External API)

CORS-enabled endpoint for external tools and automation.

```
POST /api/upload/external
Content-Type: multipart/form-data
```

**Configuration:** Set `DISABLE_EXTERNAL_API=true` in `.env` to disable.

**Form Fields:** Same as internal upload, plus `.snagx` file support.

**Duplicate Detection:** Returns 409 when `contentHash` (SHA-256 of uploaded image bytes) matches an existing image in the same namespace. `originalUrl` is stored as metadata and may log a warning if reused, but it does not block upload. If `duplicateAction=family` is supplied and no explicit `parentId` is supplied, the upload is admitted as a child variant under the oldest matched canonical parent instead of returning 409.

**Error Response (400):**

```json
{
  "error": "Duplicate image content detected",
  "duplicates": [
    { "id": "xyz", "filename": "hero.png", "folder": "website-images" }
  ]
}
```

**cURL Example:**

```bash
curl -X POST http://localhost:3000/api/upload/external \
  -F "file=@./photo.png" \
  -F "folder=my-folder" \
  -F "tags=tag1,tag2" \
  -F "namespace=app-a"
```

**Duplicate Family Override Response Fields:**

- `duplicateHandling.requestedAction`
- `duplicateHandling.matchedDuplicateIds`
- `duplicateHandling.canonicalParentId`
- `duplicateHandling.storedAsVariant`

---

### Import from URL

Download an image from a remote URL and prepare it for upload.

```
POST /api/import
Content-Type: application/json
```

**Request Body:**

```json
{
  "url": "https://example.com/image.jpg"
}
```

**Response:**

```json
{
  "name": "image.jpg",
  "type": "image/jpeg",
  "data": "<base64-encoded-image>",
  "originalUrl": "https://example.com/image.jpg",
  "size": 123456
}
```

**Workflow:** Use the response to POST to `/api/upload/external`:

```javascript
const importResponse = await fetch("/api/import", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ url: "https://example.com/image.jpg" })
});
const { data, name, type, originalUrl } = await importResponse.json();
const buffer = Buffer.from(data, "base64");

const formData = new FormData();
formData.append("file", new Blob([buffer], { type }), name);
formData.append("originalUrl", originalUrl);
formData.append("folder", "imported");

const uploadResponse = await fetch("/api/upload/external", {
  method: "POST",
  body: formData
});
```

---

### Upload Video (Page Import)

Upload short video assets for catalog ingestion via Cloudflare Stream.

```
POST /api/import/page/upload-video
Content-Type: multipart/form-data
```

**Multipart Form Fields (file mode):**

| Field | Required | Notes |
|-------|----------|-------|
| `file` | ✅ | Video file (`video/mp4`, `video/webm`, `video/quicktime`, `video/ogg`) |
| `folder` | ❌ | Folder assignment |
| `tags` | ❌ | Comma-separated tags |
| `description` | ❌ | Description |
| `namespace` | ❌ | Namespace override |
| `originalUrl` | ❌ | Source/origin URL |
| `sourceUrl` | ❌ | Source page/media URL |
| `requireSignedUrls` | ❌ | `"true"` to request signed playback URLs in Stream |

**Remote URL mode:**

```
POST /api/import/page/upload-video
Content-Type: application/json
```

```json
{
  "url": "https://cdn.example.com/loop.mp4",
  "filename": "loop.mp4",
  "folder": "loops",
  "tags": "hero,canva",
  "namespace": "app-a"
}
```

**Response:**

```json
{
  "id": "catalog-video-id",
  "assetType": "video",
  "filename": "loop.mp4",
  "uploaded": "2026-02-20T20:00:00.000Z",
  "streamUid": "a1b2c3d4e5f6",
  "playbackUrl": "https://videodelivery.net/a1b2c3d4e5f6/iframe",
  "hlsUrl": "https://videodelivery.net/a1b2c3d4e5f6/manifest/video.m3u8",
  "thumbnailUrl": "https://videodelivery.net/.../thumbnails/thumbnail.jpg",
  "videoStatus": "pending"
}
```

---

## Paginated Uploads

For large catalogs with deterministic pagination.

```
GET /api/uploads?page=1&pageSize=100&folder=my-folder
```

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | `1` | Page number (1-indexed) |
| `pageSize` | number | `50` | Items per page |
| `folder` | string | – | Filter by folder |

**Response:**

```json
{
  "page": 1,
  "pageSize": 100,
  "hasMore": true,
  "uploads": [
    {
      "uploadId": "58f27351-...-f498",
      "cloudflareUrl": "https://imagedelivery.net/…/public",
      "folder": "my-folder",
      "filename": "image.jpg",
      "originalUrl": "/images/source/path",
      "bytes": 533654,
      "contentHash": "sha256:abc123…",
      "createdAt": "2025-12-05T21:59:41.036Z"
    }
  ]
}
```

---

## Folders

### List Folders

```
GET /api/folders?namespace=app-a
```

**Response:**

```json
{
  "folders": ["folder-a", "folder-b", "folder-c"]
}
```

### Create Folder

```
POST /api/folders
Content-Type: application/json
```

**Request Body:**

```json
{ "name": "new-folder" }
```

**Response:**

```json
{ "success": true, "name": "new-folder" }
```

### Rename Folder

```
PATCH /api/folders/{name}?namespace=app-a
Content-Type: application/json
```

**Request Body:**

```json
{ "newName": "renamed-folder" }
```

**Response:**

```json
{ "success": true, "name": "renamed-folder" }
```

### Delete Folder

Removes folder assignment from all images in the folder.

```
DELETE /api/folders/{name}?namespace=app-a
```

**Response:**

```json
{ "success": true }
```

---

## Namespaces

List all registered namespaces.

```
GET /api/namespaces
```

**Response:**

```json
{
  "namespaces": ["app-a", "app-b", "website"]
}
```

---

## Search

### Semantic/Vector Search

Search using CLIP embeddings (text), color histograms, or image similarity.

```
POST /api/images/search
Content-Type: application/json
```

**Request Body:**

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"text"` \| `"image"` \| `"color"` | Search type |
| `query` | string | Search query (text) or hex color |
| `imageId` | string | Source image ID (for image-based search) |
| `limit` | number | Max results (default: 48, max: 100) |
| `namespace` | string \| null | Namespace filter (`__all__` for all, `__none__` for none) |

**Examples:**

```json
// Text search
{ "type": "text", "query": "sunset on beach", "limit": 20 }

// Color search
{ "type": "color", "query": "#3B82F6" }

// Image-based search
{ "type": "image", "imageId": "abc123" }
```

**Response:**

```json
{
  "results": [
    {
      "imageId": "abc123",
      "id": "abc123",
      "canonicalImageId": "abc123",
      "requestedImageId": "optional-original-hit-id-if-remapped",
      "filename": "example.jpg",
      "folder": "my-folder",
      "score": 0.89,
      "displayName": "Optional display name"
    }
  ],
  "count": 1,
  "query": "sunset on beach",
  "type": "text"
}
```

`imageId`/`id`/`canonicalImageId` now always point to the canonical catalog image ID for each hit.
If a backend/vector hit returns a non-canonical identifier (for example a display name), `requestedImageId`
contains that original value and the result is remapped to canonical IDs when resolvable.

---

### Similar Images

Find visually similar images by CLIP or color.

```
GET /api/images/{id}/similar?type=clip&limit=10
```

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `type` | `"clip"` \| `"color"` | `"clip"` | Similarity method |
| `limit` | number | `10` | Max results (max: 100) |
| `offset` | number | `0` | Pagination offset |
| `includeStrangers` | `"true"` | – | Also return semantically distant images |
| `strangersLimit` | number | `limit/2` | Max stranger results |
| `namespace` | string | – | Namespace filter |

**Response:**

```json
{
  "imageId": "source-id",
  "type": "clip",
  "similar": [
    { "imageId": "abc", "score": 0.92, "image": { ... } }
  ],
  "strangers": [
    { "imageId": "xyz", "score": 0.12, "image": { ... } }
  ]
}
```

---

### Antipode (Opposite) Search

Find semantic or color opposites of an image.

```
GET /api/images/{id}/antipode?domain=clip&method=stranger&limit=8
```

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `domain` | `"clip"` \| `"color"` | `"clip"` | Search domain |
| `method` | string | varies | Method (see below) |
| `limit` | number | `8` | Max results (max: 20) |
| `namespace` | string | – | Namespace filter |

**CLIP Methods:** `negate`, `stranger`, `otherwise`, `reflectroid`

**Color Methods:** `complementary`, `histogram`, `lightness`, `negative`

**Response:**

```json
{
  "imageId": "source-id",
  "domain": "clip",
  "method": "stranger",
  "results": [
    { "imageId": "abc", "score": 0.15, "image": { ... } }
  ]
}
```

---

## Colors

Batch fetch color metadata for multiple images.

```
GET /api/images/colors?ids=id1,id2,id3
```

**Response:**

```json
{
  "colors": {
    "id1": {
      "dominantColors": ["#FF5733", "#33FF57"],
      "averageColor": "#888888",
      "hasClipEmbedding": true,
      "hasColorEmbedding": true
    }
  }
}
```

---

## Embeddings

### Generate Embeddings (Single)

Generate CLIP and/or color embeddings for one image.

```
POST /api/images/{id}/embeddings
Content-Type: application/json
```

**Request Body:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `clip` | boolean | `true` | Generate CLIP embedding |
| `color` | boolean | `true` | Generate color embedding |
| `force` | boolean | `false` | Regenerate even if exists |

**Response:**

```json
{
  "imageId": "abc123",
  "message": "Embeddings generated successfully",
  "hasClipEmbedding": true,
  "hasColorEmbedding": true,
  "clipGenerated": true,
  "colorGenerated": true
}
```

---

### Generate Embeddings (Batch)

Process multiple images at once (max 50 per request).

```
POST /api/images/embeddings/batch
Content-Type: application/json
```

**Request Body:**

```json
{
  "imageIds": ["id1", "id2", "id3"],
  "clip": true,
  "color": true,
  "force": false
}
```

**Response:**

```json
{
  "results": [
    { "imageId": "id1", "success": true, "clipGenerated": true, "colorGenerated": true },
    { "imageId": "id2", "success": true, "skipped": true }
  ],
  "summary": {
    "total": 3,
    "success": 2,
    "skipped": 1,
    "errors": 0
  }
}
```

---

### Vector Status

Check Redis/vector search availability and embedding progress.

```
GET /api/images/vectors/status
```

**Response:**

```json
{
  "available": true,
  "indexName": "idx:images",
  "stats": {
    "totalImages": 1500,
    "indexedInRedis": 1200,
    "withClipEmbedding": 1100,
    "withColorEmbedding": 1150,
    "clipProgress": "73%",
    "colorProgress": "77%"
  },
  "needsEmbedding": 400
}
```

**Create/Verify Index:**

```
POST /api/images/vectors/status
```

---

## AI-Powered Features

These endpoints require `OPENAI_API_KEY` environment variable.

### Generate ALT Text

```
POST /api/images/{id}/alt
```

Uses GPT-4 Vision to generate accessibility-focused alt text and saves to Cloudflare metadata.

**Response:**

```json
{
  "id": "abc123",
  "altTag": "A golden retriever playing fetch in a sunny park",
  "generatedAt": "2025-12-05T21:59:41.036Z"
}
```

---

### Generate Description

```
POST /api/images/{id}/description
Content-Type: application/json
```

**Request Body (optional):**

```json
{ "existingDescription": "Previous description for context" }
```

**Response:**

```json
{
  "id": "abc123",
  "description": "A detailed description of the image content...",
  "generatedAt": "2025-12-05T21:59:41.036Z"
}
```

---

### Generate Prompt (PromptThis)

Generate a text-to-image prompt that could recreate the image.

```
POST /api/images/{id}/prompt
GET /api/images/{id}/prompt?force=1
```

**Response:**

```json
{
  "imageId": "abc123",
  "prompt": "A minimalist product photograph of a ceramic vase, soft natural lighting from the left, neutral beige background, shallow depth of field, clean composition, modern aesthetic...",
  "model": "gpt-4o",
  "generatedAt": "2025-12-05T21:59:41.036Z"
}
```

---

### Concept Radar

Get semantic concept scores showing how the AI interprets the image.

```
POST /api/images/{id}/concepts
```

**Response:**

```json
{
  "imageId": "abc123",
  "concepts": [
    {
      "dimension": "artificial-organic",
      "negative": "artificial",
      "positive": "organic",
      "score": 0.67,
      "negativeRaw": 0.32,
      "positiveRaw": 0.68
    },
    {
      "dimension": "dark-bright",
      "negative": "dark",
      "positive": "bright",
      "score": -0.23,
      "negativeRaw": 0.61,
      "positiveRaw": 0.39
    }
  ]
}
```

Scores range from -1 (negative pole) to +1 (positive pole).

---

### Generate Haiku

Generate a haiku poem inspired by the image's semantic qualities.

```
POST /api/images/{id}/haiku
```

**Response:**

```json
{
  "imageId": "abc123",
  "haiku": "Golden light descends\nThrough ancient forest shadows—\nPeace finds its way home",
  "concepts": [ /* concept scores used for generation */ ]
}
```

---

### Batch Prompts Lookup

Retrieve stored prompts for multiple images.

```
GET /api/images/prompts?ids=id1,id2,id3
```

**Response:**

```json
{
  "prompts": {
    "id1": "A minimalist product photograph...",
    "id2": null,
    "id3": "Vintage film photograph of..."
  }
}
```

---

## Image Manipulation

### Rotate Image

Rotate an image and re-upload to Cloudflare.

```
POST /api/images/{id}/rotate
Content-Type: application/json
```

**Request Body:**

```json
{ "direction": "right" }  // "left" or "right" for 90°
// OR
{ "degrees": 180 }        // arbitrary degrees
// OR
{ "auto": true }          // honor EXIF orientation
// OR empty body          // defaults to auto
```

**Response:**

```json
{
  "id": "new-image-id",
  "url": "https://imagedelivery.net/.../public",
  "variants": [...],
  "rotatedFromId": "original-id",
  "message": "Image rotated and re-uploaded. Update references to use new URL."
}
```

⚠️ **Note:** Creates a new Cloudflare image. Update any stored references.

---

### Create Animation

Create animated WebP from uploaded frames or URLs.

```
POST /api/animate
Content-Type: multipart/form-data
```

**Form Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `items` | JSON string | Array of frame sources (see below) |
| `fps` | number | Frames per second |
| `loop` | boolean | Loop animation (default: true) |
| `file_0`, `file_1`, ... | File | Frame files (when using file indices) |
| `folder` | string | Target folder |
| `namespace` | string | Namespace |
| `filename` | string | Output filename |

**Items Format:**

```json
[
  { "kind": "file", "fileIndex": 0 },
  { "kind": "url", "url": "https://example.com/frame2.png" },
  { "kind": "file", "fileIndex": 1 }
]
```

---

### Animate Selection

Create animation from existing Cloudflare images by ID.

```
POST /api/animate/selection
Content-Type: application/json
```

**Request Body:**

```json
{
  "ids": ["image-id-1", "image-id-2", "image-id-3"],
  "fps": 2,
  "loop": true,
  "filename": "my-animation",
  "namespace": "app-a"
}
```

**Response:**

```json
{
  "id": "new-animation-id",
  "url": "https://imagedelivery.net/.../public",
  "variants": [...],
  "filename": "my-animation.webp",
  "frameCount": 3
}
```

---

### Video to Animated WebP

Generate an animated WebP derivative from an uploaded video asset.

```
POST /api/videos/{id}/animated-webp
Content-Type: application/json
```

**Request Body (all optional):**

```json
{
  "variations": [
    {
      "maxWidth": 960,
      "maxHeight": 960,
      "maxOutputBytes": 10000000,
      "fps": 12,
      "timeoutMs": 45000,
      "loop": true,
      "filename": "clip-preview-a.webp"
    },
    {
      "maxWidth": 640,
      "maxHeight": 640,
      "maxOutputBytes": 2000000,
      "fps": 8,
      "timeoutMs": 45000,
      "loop": false,
      "filename": "clip-preview-b.webp"
    }
  ]
}
```

You can still send single-variation fields at top-level (`maxWidth`, `maxOutputBytes`, etc.) for backward compatibility.

**Response:**

```json
{
  "success": true,
  "partial": false,
  "createdCount": 2,
  "failedCount": 0,
  "animatedWebp": {
    "imageId": "derived-image-id",
    "url": "https://imagedelivery.net/.../public",
    "bytes": 431287,
    "width": 640,
    "height": 360,
    "fps": 12,
    "quality": 82,
    "attempts": 1,
    "maxWidth": 960,
    "maxHeight": 960,
    "maxOutputBytes": 10000000,
    "timeoutMs": 45000
  },
  "variations": [
    { "imageId": "derived-image-id", "url": "https://imagedelivery.net/.../public" }
  ]
}
```

Notes:
- Requires the video to be in `ready` stream status.
- Uses technical constraints (dimension/bytes/fps/timeout), not duration gating policy.
- If FFmpeg lacks WebP encoder support, response includes troubleshooting hints.

---

## Image Family Management

### Delete Family

Delete an image and all its variants.

```
POST /api/images/{id}/delete-family
Content-Type: application/json
```

**Request Body:**

```json
{
  "confirm": "DELETE_FAMILY",  // Required unless dryRun
  "dryRun": false,             // Preview what would be deleted
  "concurrency": 3,            // Parallel deletes (max: 8)
  "async": false               // Return jobId for polling
}
```

**Dry Run Response:**

```json
{
  "dryRun": true,
  "familyIds": ["parent-id", "variant-1", "variant-2"],
  "count": 3
}
```

**Delete Response:**

```json
{
  "deleted": ["parent-id", "variant-1", "variant-2"],
  "failed": [],
  "duration": 1234
}
```

**Async Response:**

```json
{
  "jobId": "job-uuid",
  "status": "running"
}
```

---

### Swap Parent

Promote a variant to be the new parent of the family.

```
POST /api/images/{id}/swap-parent
Content-Type: application/json
```

**Request Body:**

```json
{
  "newParentId": "variant-to-promote",
  "concurrency": 3,
  "dryRun": false
}
```

**Response:**

```json
{
  "newParent": "variant-to-promote",
  "updatedIds": ["old-parent", "other-variant"],
  "outcomes": [
    { "ok": true, "id": "old-parent", "parentId": "variant-to-promote" }
  ]
}
```

---

### Job Status (Delete Family)

Poll status of async delete-family jobs.

```
GET /api/jobs/delete-family/{jobId}
```

**Response:**

```json
{
  "jobId": "job-uuid",
  "status": "completed",  // "pending", "running", "completed", "failed"
  "progress": { "completed": 3, "total": 3 },
  "deleted": ["id1", "id2", "id3"],
  "failed": [],
  "startedAt": "2025-12-05T21:59:41.036Z",
  "completedAt": "2025-12-05T22:00:01.036Z"
}
```

---

## Extras (Extended Metadata)

Store additional metadata (description, alt text) in Redis, separate from Cloudflare's 1KB metadata limit.

### Get Extras

```
GET /api/images/{id}/extras
```

**Response:**

```json
{
  "imageId": "abc123",
  "record": {
    "description": "Extended description text...",
    "altText": "Detailed alt text for accessibility..."
  }
}
```

### Update Extras

```
PATCH /api/images/{id}/extras
Content-Type: application/json
```

**Request Body:**

```json
{
  "description": "New description",
  "altText": "New alt text"
}
```

Use `null` or empty string to clear a field.

---

## Backup

Manage Redis database backups. Creates RDB snapshots and compressed bundles with AOF files for data recovery.

### List Backups

Retrieve all existing backups with their timestamps and sizes.

```
GET /api/backup
```

**Response:**

```json
{
  "backups": [
    {
      "filename": "redis-backup-20260206-143022.tgz",
      "timestamp": "20260206-143022",
      "size": 15728640,
      "sizeHuman": "15 MB",
      "type": "bundle",
      "path": "/path/to/backups/redis/redis-backup-20260206-143022.tgz"
    },
    {
      "filename": "redis-backup-20260206-143022.rdb",
      "timestamp": "20260206-143022",
      "size": 14680064,
      "sizeHuman": "14 MB",
      "type": "rdb",
      "path": "/path/to/backups/redis/redis-backup-20260206-143022.rdb"
    }
  ],
  "grouped": {
    "20260206-143022": {
      "rdb": { /* BackupInfo */ },
      "bundle": { /* BackupInfo */ }
    }
  },
  "count": 3,
  "backupDir": "/path/to/backups/redis",
  "keepCount": 10
}
```

### Create Backup

Trigger a new Redis backup.

```
POST /api/backup
Content-Type: application/json
```

**Request Body:**

```json
{
  "keepCount": 10,
  "dryRun": false
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `keepCount` | number | `10` | Number of backups to retain (oldest rotated out) |
| `dryRun` | boolean | `false` | If true, show what would be done without creating backup |

**Response (Success):**

```json
{
  "success": true,
  "backup": {
    "rdb": {
      "filename": "redis-backup-20260206-143022.rdb",
      "path": "/path/to/backups/redis/redis-backup-20260206-143022.rdb",
      "size": 14680064,
      "sizeHuman": "14 MB"
    },
    "bundle": {
      "filename": "redis-backup-20260206-143022.tgz",
      "path": "/path/to/backups/redis/redis-backup-20260206-143022.tgz",
      "size": 15728640,
      "sizeHuman": "15 MB",
      "includesAof": true
    }
  },
  "timestamp": "20260206-143022",
  "steps": [
    "Triggering Redis BGSAVE...",
    "Waiting for BGSAVE to complete...",
    "Triggering BGREWRITEAOF...",
    "Copying dump.rdb from container...",
    "Created redis-backup-20260206-143022.rdb (14 MB)",
    "Creating backup bundle...",
    "Created redis-backup-20260206-143022.tgz (15 MB)",
    "Rotating old backups (keeping 10)...",
    "3 backups found, no rotation needed"
  ]
}
```

**Response (Dry Run):**

```json
{
  "dryRun": true,
  "wouldCreate": {
    "rdb": "/path/to/backups/redis/redis-backup-20260206-143022.rdb",
    "bundle": "/path/to/backups/redis/redis-backup-20260206-143022.tgz"
  },
  "container": "photarium-redis",
  "keepCount": 10
}
```

**Prerequisites:**

- Docker must be available and in PATH
- The Redis container (`photarium-redis` by default) must be running
- The backup directory must be writable

**Environment Variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKUP_DIR` | `./backups/redis` | Directory to store backups |
| `BACKUP_KEEP_COUNT` | `10` | Default number of backups to retain |
| `REDIS_CONTAINER` | `photarium-redis` | Docker container name |

---

## Audit

Check for broken/missing images in Cloudflare.

```
GET /api/images/audit?limit=100&offset=0&concurrency=8&variant=public&verbose=1
```

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `refresh` | `"1"` | – | Refresh cache first |
| `limit` | number | all | Max images to check |
| `offset` | number | `0` | Starting offset |
| `concurrency` | number | `8` | Parallel requests |
| `variant` | string | `"public"` | Variant to check |
| `verbose` | `"1"` | – | Include all results, not just broken |

**Response:**

```json
{
  "total": 1500,
  "checked": 100,
  "broken": [
    { "id": "abc123", "filename": "missing.jpg", "status": 404, "reason": "not-found" }
  ],
  "errors": []
}
```

---

## Debug

Get raw Cloudflare API response for debugging.

```
GET /api/debug
```

**Response:**

```json
{
  "raw": { /* Cloudflare API response */ },
  "count": 1500
}
```

---

## Error Responses

All endpoints return consistent error format:

```json
{
  "error": "Human-readable error message",
  "details": { /* optional additional context */ }
}
```

**Common Status Codes:**

| Code | Meaning |
|------|---------|
| 400 | Bad Request - Invalid parameters |
| 404 | Not Found - Image/resource doesn't exist |
| 409 | Conflict - Duplicate detected |
| 500 | Server Error - Check configuration |
| 502 | Bad Gateway - Upstream (Cloudflare) error |
| 503 | Service Unavailable - Redis/vector search not available |

---

## Environment Variables

Required configuration:

```env
CLOUDFLARE_ACCOUNT_ID=your-account-id
CLOUDFLARE_API_TOKEN=your-api-token
CLOUDFLARE_DELIVERY_URL=https://imagedelivery.net/your-hash

# Optional
IMAGE_NAMESPACE=default-namespace
OPENAI_API_KEY=sk-...  # For AI features
DISABLE_EXTERNAL_API=false
```

---

## Rate Limiting & Best Practices

1. **Batch operations** when possible (use batch embeddings endpoint)
2. **Use pagination** for large catalogs (`/api/uploads`)
3. **Cache responses** client-side when appropriate
4. **Check vector status** before search operations
5. **Use namespace filters** to scope queries
6. **Handle 503 errors** gracefully (Redis may be unavailable)

---

## SDK Example (TypeScript)

```typescript
class PhotoariumClient {
  constructor(private baseUrl: string) {}

  async listImages(options?: { namespace?: string; folder?: string }) {
    const params = new URLSearchParams();
    if (options?.namespace) params.set('namespace', options.namespace);
    const response = await fetch(`${this.baseUrl}/api/images?${params}`);
    return response.json();
  }

  async uploadImage(file: File, metadata?: {
    folder?: string;
    tags?: string[];
    namespace?: string;
  }) {
    const formData = new FormData();
    formData.append('file', file);
    if (metadata?.folder) formData.append('folder', metadata.folder);
    if (metadata?.tags) formData.append('tags', metadata.tags.join(','));
    if (metadata?.namespace) formData.append('namespace', metadata.namespace);

    const response = await fetch(`${this.baseUrl}/api/upload/external`, {
      method: 'POST',
      body: formData,
    });
    return response.json();
  }

  async searchByText(query: string, limit = 20) {
    const response = await fetch(`${this.baseUrl}/api/images/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'text', query, limit }),
    });
    return response.json();
  }

  async getSimilar(imageId: string, options?: { type?: 'clip' | 'color'; limit?: number }) {
    const params = new URLSearchParams();
    if (options?.type) params.set('type', options.type);
    if (options?.limit) params.set('limit', String(options.limit));
    const response = await fetch(`${this.baseUrl}/api/images/${imageId}/similar?${params}`);
    return response.json();
  }

  async generateEmbeddings(imageId: string) {
    const response = await fetch(`${this.baseUrl}/api/images/${imageId}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clip: true, color: true }),
    });
    return response.json();
  }
}

// Usage
const client = new PhotoariumClient('http://localhost:3000');
const images = await client.listImages({ namespace: 'my-app' });
const results = await client.searchByText('sunset over mountains');
```
