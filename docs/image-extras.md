# Image Extras (Non-Cloudflare Metadata)

Photarium stores some per-image data *outside* Cloudflare Images metadata to avoid Cloudflare metadata size limits and to support richer, evolving fields.

## What stays in Cloudflare metadata (small + filterable)

These fields should remain in Cloudflare Images metadata because they are small and commonly used for filtering/browsing:

- `namespace`
- `folder`
- `tags`
- other small, stable, filter-driven fields (e.g. `parentId`, simple flags)

## What goes into Extras Storage

These fields can be larger, change frequently, or are derived. They are stored in **Extras Storage** (Redis for flagship installs, or file fallback):

- `description` (long-form)
- `altText` (long-form)
- Prompt This (generated prompt text)
- future fields: captions/OCR, annotations, notes, etc.

## Storage backend

Extras Storage is configured via environment variables:

```bash
EXTRAS_STORAGE_TYPE=auto          # auto|redis|file
EXTRAS_STORAGE_DIR=.extras        # only used when EXTRAS_STORAGE_TYPE=file
REDIS_URL=redis://localhost:6379  # used when EXTRAS_STORAGE_TYPE=redis (or auto selects redis)
```

## Record schema

Extras are stored as one JSON record per image.

- Key: `image-extras:<imageId>`
- Schema version: `schemaVersion: 1`

Example shape:

```json
{
  "schemaVersion": 1,
  "imageId": "<cloudflare-image-id>",
  "description": "...optional...",
  "altText": "...optional...",
  "promptThis": {
    "prompt": "...",
    "model": "gpt-4o",
    "provider": "openai",
    "createdAt": "2026-01-28T00:00:00.000Z",
    "updatedAt": "2026-01-28T00:00:00.000Z"
  },
  "createdAt": "2026-01-28T00:00:00.000Z",
  "updatedAt": "2026-01-28T00:00:00.000Z"
}
```

## Backwards compatibility

Earlier versions stored Prompt This under a legacy key `prompt-this:<imageId>`.

Current code will read from the unified record first, then fall back to the legacy key and (best-effort) migrate into the unified record.

## Migrating existing Description/ALT

If you already have `description` / `altTag` stored in Cloudflare metadata, migrate them into Extras Storage with:

- `node scripts/migrate-description-alt-to-extras.mjs --dry-run`
- `node scripts/migrate-description-alt-to-extras.mjs --namespace=<ns>`
- Add `--clear-cloudflare` to remove the migrated fields from Cloudflare metadata after writing extras.
