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
- creative-brief derivation history (briefs, derived prompts, provider handoffs, and generated-child provenance)
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
    "model": "gpt-4.1-nano",
    "provider": "openai",
    "createdAt": "2026-01-28T00:00:00.000Z",
    "updatedAt": "2026-01-28T00:00:00.000Z"
  },
  "createdAt": "2026-01-28T00:00:00.000Z",
  "updatedAt": "2026-01-28T00:00:00.000Z"
}
```

## Revision token and the folder-override cache

Gallery requests need each image's extras-stored `folder`. Reading the whole
extras keyspace per request (a `SCAN` + `MGET` over ~18k keys) was the largest
steady-state cost of `/api/images`, so the folder values are held in a
write-through in-memory map with a periodic refresh
([src/server/imageExtras.ts](../src/server/imageExtras.ts)).

Two keys support this:

- `image-extras:<imageId>` — the record itself.
- `image-extras-meta:revision` — a random token rewritten on **every** extras
  write. Note the distinct `image-extras-meta:` prefix: it must not match the
  `image-extras:` record prefix, or record enumeration would pick it up.

The refresh reads the token first. If it is unchanged since the last full load,
the `SCAN` + `MGET` is skipped *and* the map's version counter is left alone.
That version counter keys the gallery's memo caches and HTTP ETags, so bumping it
on every periodic reload would have invalidated every gallery cache every five
minutes. See [Gallery Performance And Cache Invariants](./gallery-performance.md).

`setImageExtrasRecord` and `deleteImageExtrasRecord` both update the in-memory
map, bump the version, and rewrite the token. **Any new extras write path must go
through them** (or replicate all three steps), otherwise the gallery can serve
stale folder data behind a `304`.

## Backwards compatibility

Earlier versions stored Prompt This under a legacy key `prompt-this:<imageId>`.

Current code will read from the unified record first, then fall back to the legacy key and (best-effort) migrate into the unified record.

Creative-brief derivations are stored separately under `prompt-derivations:<imageId>` so the canonical `promptThis` record remains stable. Each derivation retains its source image ID, brief, final prompt, source relationship, reference roles, provider, requested aspect ratio, generated child ID, external job ID, and actual output dimensions/ratio when recorded.

## Migrating existing Description/ALT

If you already have `description` / `altTag` stored in Cloudflare metadata, migrate them into Extras Storage with:

- `node scripts/migrate-description-alt-to-extras.mjs --dry-run`
- `node scripts/migrate-description-alt-to-extras.mjs --namespace=<ns>`
- Add `--clear-cloudflare` to remove the migrated fields from Cloudflare metadata after writing extras.
