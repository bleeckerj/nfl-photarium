# Instagram Video Ingest Regression: Byte-Range URLs Causing Cloudflare Stream Failures

## Summary

Instagram single-URL video ingest regressed for some posts and carousel video items.

The user-facing symptom was:

- `npm run ig:url -- --url 'https://www.instagram.com/p/.../?img_index=4' ...` appeared to create video records
- the gallery showed video cards with broken thumbnails
- affected videos stayed in `pending` or flipped to `error`
- Cloudflare Stream delivery URLs such as `/thumbnails/thumbnail.jpg` or `/watch` returned HTTP `424`

This was not a user-command issue. The Instagram single-URL ingest path was correct. The regression was in how the script selected and uploaded Instagram video URLs.

## Commands Affected

This issue affected the Instagram single-URL ingest flow, including commands like:

```bash
npm run ig:url -- \
  --url 'https://www.instagram.com/p/DFTn7ScyFsp/?img_index=4' \
  --namespace cf-default \
  --username activelyblack
```

It also affected replay/recovery flows that reused the same extracted `videoUrls`.

## Symptom Pattern

Affected records looked like this:

- `filename`: `DFTn7ScyFsp.mp4`
- `videoStatus`: `pending` or `error`
- Stream URLs existed:
  - `.../iframe`
  - `.../manifest/video.m3u8`
  - `.../thumbnails/thumbnail.jpg`
- but the Stream asset was not actually usable

Observed live behavior:

- `/api/videos/:id?refresh=1` showed the asset remaining `error`
- Stream delivery endpoints returned HTTP `424`
- some records showed nonsense metadata such as `durationSeconds: 0` or `-1`

## Root Cause

The Instagram extractor was sometimes selecting `videoUrls` that included byte-range query params:

- `bytestart`
- `byteend`
- sometimes `range`

Example shape:

```text
https://scontent-...cdninstagram.com/...mp4?...&bytestart=0&byteend=817
```

Those URLs are partial byte-range fragments, not stable canonical full-video URLs for upload purposes.

### Why this broke ingest

The ingest script fetched the discovered Instagram URL and uploaded the bytes as a video file to Cloudflare Stream.

When the selected Instagram URL was a byte-range fragment:

- the fetched payload could be only a tiny partial MP4 fragment
- Stream accepted the upload request strongly enough for a local video record to be created
- but Stream could not produce a valid playable asset
- downstream Stream endpoints then failed with HTTP `424`

One verified example:

- URL with `bytestart=0&byteend=817` returned only `818` bytes
- the same URL with those params removed resolved to the full MP4 payload

## Why It Used To Work

This was a regression, not a permanent platform limitation.

Possible reasons it worked previously:

- Instagram previously exposed cleaner full-video URLs more often
- the extractor previously happened to prefer a usable full variant
- newer Instagram responses exposed more segmented or partial delivery URLs, which the script did not sanitize

The repository still contained older successful Instagram video ingests, which confirmed the feature had worked before.

## Fix

The fix was implemented in:

- [scripts/instagram-ingest.mjs](/Users/julian/Code/cloud-flare-image-handler/scripts/instagram-ingest.mjs)

### Changes made

1. Added video URL sanitization before upload.

- Strip byte-range query params:
  - `bytestart`
  - `byteend`
  - `range`

2. Normalized video deduplication keys using sanitized URLs.

- This prevents multiple fragment variants from being treated as distinct canonical upload candidates.

3. Filtered out likely audio-only Instagram stream variants.

- The script now decodes Instagram `efg` metadata and rejects URLs whose `vencode_tag` indicates audio-only media.

4. Applied sanitization both:

- when reducing/selecting candidate `videoUrls`
- and immediately before uploading to Cloudflare

### Relevant implementation areas

- URL sanitization and filtering logic near:
  - `decodeInstagramEfg(...)`
  - `isLikelyAudioOnlyInstagramVideoUrl(...)`
  - `sanitizeVideoUrlForUpload(...)`
  - `reduceVideoUrlsForUpload(...)`
- Upload enforcement in:
  - `pushVideoToCloudflare(...)`

## Validation Performed

Validation performed during debugging:

1. Queried live app data for broken records using `/api/images`.
2. Refreshed individual video assets using `/api/videos/:id?refresh=1`.
3. Verified Stream delivery URLs for affected assets returned HTTP `424`.
4. Compared an Instagram URL with and without byte-range params:
   - with `bytestart/byteend`: partial payload only
   - without those params: full MP4 available
5. Ran syntax validation:

```bash
node --check scripts/instagram-ingest.mjs
```

## Recovery For Already Broken Records

The fix only prevents future bad uploads. It does not repair already-created broken Cloudflare Stream assets.

For already broken records:

1. Delete the broken video assets from the gallery or video detail page.
2. Re-run the ingest or replay workflow after the fix.

Recommended replay path:

```bash
node scripts/instagram-video-recover.mjs \
  --input data/instagram/<username>.ndjson \
  --namespace <namespace> \
  --headful
```

For one-off direct reingest:

```bash
npm run ig:url -- \
  --url 'https://www.instagram.com/p/<shortcode>/?img_index=<n>' \
  --namespace <namespace> \
  --username <owner_username>
```

## How To Recognize This Failure Quickly In The Future

Search for these signals:

- `Instagram video ingest failing`
- `ig:url video pending error`
- `Cloudflare Stream 424`
- `Instagram bytestart byteend mp4`
- `DFTn7ScyFsp.mp4 pending error`
- `thumbnail.jpg returns 424`
- `videoStatus pending error stream asset`

Technical indicators:

- `originalUrl` contains `bytestart=` or `byteend=`
- `videoStatus` stays `pending` unusually long or becomes `error`
- `thumbnailUrl` or `previewUrl` exists but does not render
- Stream delivery endpoints return HTTP `424`

## Relevant Files

- [scripts/instagram-ingest.mjs](/Users/julian/Code/cloud-flare-image-handler/scripts/instagram-ingest.mjs)
- [scripts/instagram-video-recover.mjs](/Users/julian/Code/cloud-flare-image-handler/scripts/instagram-video-recover.mjs)
- [src/server/videoUploadService.ts](/Users/julian/Code/cloud-flare-image-handler/src/server/videoUploadService.ts)
- [src/server/videoCatalogStorage.ts](/Users/julian/Code/cloud-flare-image-handler/src/server/videoCatalogStorage.ts)
- [src/server/cloudflareStreamClient.ts](/Users/julian/Code/cloud-flare-image-handler/src/server/cloudflareStreamClient.ts)

## Short Version

The bug was:

- Instagram video ingest sometimes uploaded a partial byte-range MP4 fragment instead of the full video

The effect was:

- broken Cloudflare Stream assets with `pending` / `error` status and HTTP `424` delivery failures

The fix was:

- sanitize Instagram video URLs before upload by stripping byte-range params and skipping audio-only variants
