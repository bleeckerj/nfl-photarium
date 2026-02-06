# Aspect Ratio Persistence (Redis) — Implementation Plan

## Goal
Persist image aspect ratios and dimensions in Redis to avoid on-the-fly computation and enable fast filtering/UI rendering.

## Data Model (Redis)
- Key: `image:meta:{id}` (Hash)
  - `aspectRatio` (string) — canonical ratio string (ex: `16:9`, `1:1`, `4:3`)
  - `width` (int)
  - `height` (int)
  - `aspectRatioUpdatedAt` (ISO timestamp)

> Alternative: extend the existing vector metadata structure if that is the canonical store for image metadata.

## Write Path
1. On image upload / image metadata update:
   - Fetch dimensions once (use Cloudflare `public`/`original` URL).
   - Compute ratio: `width / height`.
   - Compute canonical string (reduce to nearest common ratio or `1:1` when within tolerance).
   - Write to Redis hash fields in a single pipeline.

2. On image replace/refresh:
   - Recompute dimensions and update the same hash fields.

## Read Path
1. In `GET /api/images`:
   - Collect image IDs from the response list.
   - Batch fetch `aspectRatio`, `width`, `height` from Redis for those IDs.
   - Merge into the image payload as:
     - `dimensions: { width, height }`
     - `aspectRatio: string`

2. Ensure missing Redis entries do not break the response (fallback to `undefined`).

## Backfill Script
- Script: `scripts/backfill-aspect-ratios.mjs`
- Flow:
  1. Fetch all image IDs.
  2. For each image ID, check Redis for existing ratio fields.
  3. For missing entries, compute dimensions and ratio.
  4. Store in Redis using batched pipelines.
- Add concurrency limits and retry/backoff for image fetch failures.

## Cache Invalidation
- Only recompute if:
  - Dimensions are missing or invalid, or
  - Image has been replaced/updated.
- Otherwise reuse Redis values.

## Client Changes
- When Redis-backed `dimensions` and `aspectRatio` are present in the API response:
  - Remove or bypass client-side aspect ratio calculations.
  - Use persisted values for filters and UI display.

## Observability
- Log failures and retries during backfill.
- Track coverage: number of images with ratio data vs total.
- Optional: status endpoint to report backfill progress.

## Rollout
1. Ship Redis write path for new uploads/updates.
2. Run backfill script for existing images.
3. Enable filter/UI usage of persisted aspect ratios.
4. Remove client-side calculation fallback (optional after data coverage is sufficient).
