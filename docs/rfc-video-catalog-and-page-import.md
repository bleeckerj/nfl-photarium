# RFC: Video Support in Catalog + Page Import (Including `blob:` Sources)

- Status: Draft
- Author: Codex
- Created: February 18, 2026
- Target Repo: `/Users/julian/Code/cloud-flare-image-handler`

## Summary

Add first-class video support to the catalog system using Cloudflare Stream for short-loop clips, while preserving existing image workflows on Cloudflare Images.

This RFC focuses on:

1. Catalog support for `image` and `video` assets.
2. Page import support for discoverable video elements (`<video>` + `<source>`).
3. Reliable ingestion of `blob:` video sources (for example Canva) via browser-side capture.
4. Incremental rollout with low risk to existing APIs and UI.

## Motivation

Current implementation is image-first and rejects non-image imports in page-upload flows. This blocks a common workflow where the original video file is no longer available, but a playable `<video>` still exists on a page.

Example blocked case:

```html
<video aria-label="37a7390a12291015429da39931bf1e58.mp4" ...>
  <source src="blob:https://www.canva.com/4b6aac20-ab7c-4ded-b6a6-3ed61ae37f88" type="">
</video>
```

`blob:` URLs are browser-memory references and cannot be fetched by server-side import endpoints directly.

## Goals

1. Support importing short videos as catalog assets.
2. Support both `http(s)` video URLs and `blob:` video sources from page context.
3. Keep existing image upload/import behavior unchanged.
4. Reuse namespace/folder/tags metadata patterns.
5. Introduce minimal API/UI changes first, then unify into broader asset model.

## Non-Goals

1. Full long-form video CMS behavior.
2. Video semantic embeddings/search in phase 1.
3. Replacing existing image animation endpoints (`/api/animate*`) in phase 1.

## Current State (Relevant)

1. `/api/import/page` and `/api/import/page/scroll` discover image URLs only.
2. `/api/import/page/upload` accepts image URLs and routes to image upload pipeline.
3. Upload pipeline (`src/server/uploadService.ts`) enforces image MIME support.
4. Gallery types/hooks are image-shaped (`CloudflareImage` model).

## Proposed Architecture

### Storage/Delivery Split

1. Keep Cloudflare Images for image assets and existing animated WebP behavior.
2. Use Cloudflare Stream for true video assets (short loops included).

### Catalog Asset Model

Introduce a generalized catalog asset shape:

```ts
type CatalogAsset = {
  id: string; // catalog ID
  assetType: 'image' | 'video';
  filename: string;
  uploaded: string;
  folder?: string;
  tags?: string[];
  description?: string;
  namespace?: string;
  originalUrl?: string;
  sourceUrl?: string;

  // image fields (existing)
  variants?: string[];
  parentId?: string;

  // video fields
  streamUid?: string;
  durationSeconds?: number;
  playbackUrl?: string;
  hlsUrl?: string;
  thumbnailUrl?: string;
  previewGifUrl?: string;
  videoStatus?: 'pending' | 'ready' | 'error';
};
```

Phase 1 can maintain separate image/video APIs and add a unified `/api/assets` endpoint without breaking `/api/images`.

## API Design

### 1) Extend page discovery to include videos

#### `POST /api/import/page`

- Existing: returns discoverable image URLs.
- New: return both images and videos.

Response item shape:

```json
{
  "kind": "video",
  "url": "https://example.com/video.mp4",
  "filename": "video.mp4",
  "contentType": "video/mp4",
  "isBlob": false
}
```

For blob candidate:

```json
{
  "kind": "video",
  "url": "blob:https://www.canva.com/...",
  "filename": "37a7390a12291015429da39931bf1e58.mp4",
  "contentType": "",
  "isBlob": true
}
```

#### `POST /api/import/page/scroll`

Match the same response shape for parity.

### 2) Add video ingest endpoint(s)

#### `POST /api/import/page/upload-video`

Supports two modes:

1. **Remote mode (`http(s)`)**: request includes URL item(s); server fetches bytes and uploads to Stream.
2. **Blob mode**: request includes multipart `file`; server uploads provided bytes to Stream.

Request fields (multipart or JSON depending on mode):

- `file` (required for blob mode)
- `url` (required for remote mode)
- `filename` (optional; fallback from URL/metadata)
- `folder`, `tags`, `description`, `namespace`
- `originalUrl`, `sourceUrl`

Response:

```json
{
  "id": "catalog-video-id",
  "assetType": "video",
  "streamUid": "xxxx",
  "playbackUrl": "https://customer-<code>.cloudflarestream.com/<uid>/manifest/video.m3u8",
  "thumbnailUrl": "...",
  "videoStatus": "pending"
}
```

### 3) Optional unified read endpoint

#### `GET /api/assets`

- Returns both image and video assets.
- Query flags mirror existing namespace/filter patterns where possible.

## Blob Video Handling (Critical)

### Constraint

Server cannot fetch `blob:` URL values directly because the bytes exist only in the user’s page/browser process.

### Required behavior

1. Discovery marks `isBlob: true`.
2. UI marks these items as “browser capture required”.
3. Capture occurs in browser context that can resolve the blob URL.
4. Captured bytes are uploaded as `File` to `/api/import/page/upload-video`.

### Browser-side capture strategy

For selected blob video item:

1. Run `fetch(blobUrl)` in the page/browser context.
2. Convert `Blob -> File`.
3. Send multipart upload to app server.

Pseudo:

```ts
const res = await fetch(blobUrl);
const blob = await res.blob();
const file = new File([blob], inferredFilename, { type: blob.type || 'video/mp4' });
```

### Canva-specific notes

1. `aria-label` often carries useful filename.
2. `video.currentSrc` may be more reliable than nested `source.src`.
3. Capture must occur while Canva session is active and media remains accessible.

## Server Implementation Plan

### New modules

1. `src/server/cloudflareStreamClient.ts`
2. `src/server/videoUploadService.ts` (validation, dedupe policy, metadata assembly)

### New routes

1. `src/app/api/import/page/upload-video/route.ts`
2. (optional) `src/app/api/assets/route.ts`

### Changes to existing routes

1. `src/app/api/import/page/route.ts`:
   - Extract `<video>`/`<source>` URLs.
   - Return `kind` + `isBlob`.
2. `src/app/api/import/page/scroll/route.ts`:
   - Extract runtime video URLs from DOM.
   - Return mixed asset candidates.

## UI/UX Plan

### Uploader queue model

Extend `QueuedFile` with:

```ts
assetType?: 'image' | 'video';
isBlobSource?: boolean;
```

### Queue behaviors

1. `image/http(s)` -> existing path.
2. `video/http(s)` -> `/api/import/page/upload-video` remote mode.
3. `video/blob` -> browser-capture then `/api/import/page/upload-video` multipart mode.

### Preview behavior

1. Videos render poster/thumbnail if available; fallback label when unavailable.
2. For blob items, show capture state (`not captured`, `captured`, `failed`).

## Security and Compliance

1. Keep Stream credentials server-only.
2. Continue SSRF protections for remote URL fetches:
   - allow only `http`/`https`
   - block private/localhost hosts
3. Enforce size/type limits for uploaded video bytes.
4. Honor rights/terms for third-party hosted media import.

## Observability

Emit structured logs for:

1. Discovery counts (`image`, `video`, `blobVideo`).
2. Capture/upload outcomes by source mode (`remote`, `blob`).
3. Stream processing lifecycle (`pending`, `ready`, `error`).

## Backward Compatibility

1. Existing image endpoints remain unchanged.
2. Existing gallery can continue using `/api/images`.
3. New video behavior can be feature-flagged:
   - `ENABLE_VIDEO_IMPORT=1`
   - `ENABLE_VIDEO_ASSETS=1`

## Phased Rollout

### Phase 1: Video ingest foundation

1. Stream client + upload-video route.
2. Minimal catalog persistence for video metadata.
3. Manual upload test path (file upload).

### Phase 2: Page discovery + blob capture

1. Extend page import extraction for videos.
2. UI capture flow for `blob:` sources.
3. End-to-end Canva validation.

### Phase 3: Unified catalog UX

1. `/api/assets` endpoint.
2. Mixed image/video gallery cards.
3. Video detail actions (copy playback links, delete, metadata edit).

## Acceptance Criteria

1. `POST /api/import/page` returns video candidates from pages containing `<video>`.
2. `blob:` candidates are surfaced with `isBlob=true`.
3. User can import a Canva `blob:` video into catalog via browser capture path.
4. Imported video appears as catalog asset with namespace/folder/tags metadata.
5. Existing image import/upload flows continue to pass current tests.

## Test Plan

1. Unit:
   - HTML extraction for `<video>` and nested `<source>`.
   - `isBlob` detection.
   - video MIME/type validation.
2. Integration:
   - `/api/import/page/upload-video` remote URL success/failure.
   - multipart blob upload success/failure.
3. Manual:
   - Canva page with blob video.
   - Standard MP4 URL page import.
   - Regression checks for image-only page import.

## Open Questions

1. Should short loop videos also generate an automatic animated WebP derivative for thumbnail parity?
2. Do we want one catalog ID namespace for both image and video assets immediately, or maintain parallel IDs in phase 1?
3. Should private Stream delivery (signed URLs) be required at launch or deferred?

## Implementation Checklist

1. Add Stream env vars and docs.
2. Implement Stream client module.
3. Add upload-video API route.
4. Extend page extraction for videos.
5. Add uploader queue `assetType` + blob capture path.
6. Add tests for extraction and upload-video route.
7. Add feature flag + release notes.

