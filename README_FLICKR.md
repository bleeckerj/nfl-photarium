# Flickr Ingest for Photarium

This utility imports photos and videos you own on Flickr into Photarium.

It supports:

- full-library ingest
- album/photoset-title ingest
- tag-based ingest
- resumable runs via checkpoint files
- count-limited tranches that advance past completed media on each resumed run
- runtime-limited runs that finish in-flight uploads after the deadline
- account completion, tranche progress, elapsed time, and remaining-time estimates
- duplicate content is uploaded as an independent Photarium asset for later refinement
- colorful verbose logging
- dry-run mode

Current implementation notes:

- photos and Flickr-hosted videos are ingested; other media types are skipped
- "collection name" is implemented as Flickr album/photoset title
- true Flickr Collection tree traversal is not implemented
- default target namespace is `cf-flickr`
- in album mode, the album title maps to Photarium `folder`

## Prerequisites

- A working local Photarium instance, usually at `http://localhost:3000`
- A Flickr API Key and API Secret
- Node.js installed in this repo environment

Relevant npm scripts:

- `npm run flickr:auth`
- `npm run flickr:ingest -- ...`

## Flickr API Key and Secret

Flickr’s official developer docs say you need an application key to use the API, and that authenticated access uses OAuth 1.0a with a request token, user authorization, and access token exchange.

Official references:

- [Flickr API Keys](https://www.flickr.com/services/api/misc.api_keys.html)
- [Flickr User Authentication / OAuth](https://www.flickr.com/services/api/auth.oauth.html)
- [Flickr Developer Guide](https://www.flickr.com/services/developer/api)
- [Flickr API Terms](https://www.flickr.com/help/terms/api)

To get a key and secret:

1. Sign in to Flickr with the account that will own the API application.
2. Open the Flickr App Garden / API keys flow from the official docs above.
3. Apply for an API key and provide a short description of the tool.
   Suggested description:
   `Personal backup and metadata-ingest utility for importing my own Flickr photos into my local Photarium archive.`
4. Once approved, copy the generated API Key and API Secret.
5. Export them in your shell:

```bash
export FLICKR_API_KEY="your-flickr-api-key"
export FLICKR_API_SECRET="your-flickr-api-secret"
```

Notes:

- Flickr’s API docs state that non-commercial use is the standard path, and commercial use requires prior permission.
- This tool is designed for authenticated access to your own library, including private photos you can view.

## First-Time Auth

Run:

```bash
npm run flickr:auth
```

Or, if you prefer to pass credentials explicitly:

```bash
npm run flickr:auth -- \
  --api-key "$FLICKR_API_KEY" \
  --api-secret "$FLICKR_API_SECRET"
```

What happens:

1. The script requests a Flickr OAuth request token.
2. It prints a Flickr authorization URL.
3. You open that URL in a browser and approve `read` access.
4. Flickr gives you a verifier code.
5. You paste that verifier back into the terminal.
6. The script stores the resulting access token in:

```text
data/flickr-ingest/auth.json
```

You can override that path with:

```bash
--auth-file /custom/path/auth.json
```

## Basic Usage

### Ingest everything

```bash
npm run flickr:ingest -- --selector all
```

### Ingest a specific album by title

```bash
npm run flickr:ingest -- \
  --selector album \
  --album "Road Trip 2019"
```

### Ingest multiple albums

```bash
npm run flickr:ingest -- \
  --selector album \
  --album "Road Trip 2019" \
  --album "Studio Work"
```

### Ingest by explicit Flickr album id

Use this when titles are ambiguous.

```bash
npm run flickr:ingest -- \
  --selector album \
  --album-id "72177720300000000"
```

### Ingest by tag

```bash
npm run flickr:ingest -- \
  --selector tag \
  --tag architecture
```

### Ingest by multiple tags with OR logic

```bash
npm run flickr:ingest -- \
  --selector tag \
  --tag architecture \
  --tag night \
  --tag-mode any
```

### Ingest by multiple tags with AND logic

```bash
npm run flickr:ingest -- \
  --selector tag \
  --tag architecture \
  --tag night \
  --tag-mode all
```

## Dry Run

`--dry-run` already exists.

It resolves selectors and logs what would be processed without uploading to Photarium.

Examples:

```bash
npm run flickr:ingest -- \
  --selector all \
  --dry-run \
  -vv
```

```bash
npm run flickr:ingest -- \
  --selector album \
  --album "Road Trip 2019" \
  --dry-run \
  -vvvv
```

## Recommended Real Runs

### Conservative first pass

Use this to verify auth, selector resolution, and output shape:

```bash
npm run flickr:ingest -- \
  --selector all \
  --limit 25 \
  -vvv
```

Rerunning the same command advances to the next 25 incomplete items. Successfully imported checkpoint entries do not consume the new tranche limit. Failed and previously unsupported items remain eligible for retry.

### Time-boxed run

Use runtime mode when you want the ingest to keep starting uploads for a fixed amount of time:

```bash
npm run flickr:ingest -- \
  --selector all \
  --runtime 2h \
  -vvv
```

The runtime begins when media processing starts, after Flickr selector enumeration. When the deadline arrives, no new items start; uploads already in progress are allowed to finish and checkpoint normally. `--runtime` and `--limit` cannot be combined.

### Full-library backup run

```bash
npm run flickr:ingest -- \
  --selector all \
  --namespace cf-flickr \
  --concurrency 2 \
  --api-throttle-ms 250 \
  --throttle-ms 400 \
  -vv
```

### Album-focused ingest into the default Flickr namespace

```bash
npm run flickr:ingest -- \
  --selector album \
  --album "Portfolio" \
  --namespace cf-flickr \
  -vvv
```

## Important Flags

- `--namespace <name>`: target Photarium namespace; default `cf-flickr`
- `--selector <all|album|tag>`: required selector mode
- `--album <title>`: album title selector, repeatable
- `--album-id <id>`: explicit Flickr album id, repeatable
- `--tag <tag>`: tag selector, repeatable
- `--tag-mode <any|all>`: tag matching behavior; default `any`
- `--limit <n>`: process the next N incomplete media items; resumed runs advance beyond successful checkpoint entries
- `--runtime <duration>`: start uploads for the requested duration, accepting plain milliseconds or `ms`, `s`, `m`, and `h` suffixes; cannot be combined with `--limit`
- `--dry-run`: resolve and log work without uploading
- `--no-resume`: ignore prior successful checkpoint state
- `--checkpoint-file <path>`: custom checkpoint file
- `--run-log-file <path>`: custom NDJSON event log path
- `--auth-file <path>`: custom OAuth token storage path
- `--concurrency <n>`: parallel worker count
- `--api-throttle-ms <n>`: minimum interval between Flickr API calls
- `--throttle-ms <n>`: minimum interval between Photarium upload attempts
- `--retry-max <n>`: retry attempts for retryable failures
- `--retry-base-ms <n>`: base backoff delay
- `-v` through `-vvvvv`: increasing verbosity
- `--no-color`: disable ANSI color output

## Checkpoints and Logs

The utility is restart-safe.

By default it writes:

- auth tokens under `data/flickr-ingest/auth.json`
- checkpoint files under `data/flickr-ingest/checkpoints/`
- run logs under `data/flickr-ingest/runs/`

Checkpoint behavior:

- successful photo and video uploads are recorded
- identical image bytes are uploaded independently with Photarium's `duplicateAction=override`
- videos are uploaded as independent Cloudflare Stream records
- unchanged successful media is skipped before applying `--limit`
- failed items keep error state so you can rerun later
- media previously marked unsupported is retried after ingest support is added

If a run is interrupted, rerun the same command and it will resume from checkpoint state unless you pass `--no-resume`.

Runtime mode stops starting new work when its deadline arrives and waits for uploads already in progress to finish:

```bash
npm run flickr:ingest -- --selector all --runtime 2h
```

The final elapsed time can exceed the requested runtime by the time needed to finish those in-flight uploads.

## Progress Output

Full-account runs report completed, remaining, and total account media; tranche position; and elapsed processing time:

```text
✅ [ OK  ] [290/12,626/12,916 complete/left/total] [83/400 tranche] [elapsed 00:14:32] 31900823717 uploaded photo -> <photarium-id>
```

For runtime runs, the tranche denominator is shown as `runtime` because the number of items that can start depends on throughput:

```text
✅ [ OK  ] [290/12,626/12,916 complete/left/total] [83/runtime tranche] [elapsed 00:14:32] 31900823717 uploaded photo -> <photarium-id>
```

The final tally reports the actual tranche duration, successful uploads versus started items, and an estimate for the remaining account based on the current tranche's successful throughput:

```text
tranche elapsed=01:08:42 successful=396/400 estimated-account-remaining=36:28:15
```

If no item succeeds, the remaining-time estimate is `unavailable`.

## Metadata Mapping

Photarium mapping defaults:

- namespace: `cf-flickr` unless overridden
- folder: album title in album mode
- tags: Flickr tags plus a stable `flickr` tag
- display name: Flickr title
- description: Flickr description
- source URL: Flickr photo page permalink
- original URL: chosen downloadable Flickr asset URL
- duplicate policy for images: `override`, producing an independent Photarium asset

The ingest prefers the original image or video rendition when Flickr exposes it. Images fall back to the largest available image size; videos fall back to the largest available video rendition. Image imports retain Flickr provenance in image extras. Video imports retain the Flickr page and selected media URLs in the video record.

## Examples with Custom Paths

Use a custom auth file:

```bash
npm run flickr:auth -- \
  --auth-file "/Users/julian/.config/photarium/flickr-auth.json"
```

Use a custom checkpoint file:

```bash
npm run flickr:ingest -- \
  --selector all \
  --checkpoint-file "/Users/julian/Code/cloud-flare-image-handler/data/flickr-ingest/checkpoints/main-library.json"
```

Use a custom run log:

```bash
npm run flickr:ingest -- \
  --selector tag \
  --tag archive \
  --run-log-file "/Users/julian/Code/cloud-flare-image-handler/data/flickr-ingest/runs/archive-pass.ndjson"
```

## Troubleshooting

### Missing API key or secret

If you see a missing credentials error, make sure:

- `FLICKR_API_KEY` is exported
- `FLICKR_API_SECRET` is exported

Check quickly:

```bash
echo "$FLICKR_API_KEY"
echo "$FLICKR_API_SECRET"
```

### Auth file not found

Run:

```bash
npm run flickr:auth
```

again to create the token file.

### Album title is ambiguous

If multiple Flickr albums have the same title, the ingest will refuse to guess. Re-run using:

```bash
--album-id "<photoset-id>"
```

### Photarium not reachable

If your local Photarium server is not on `http://localhost:3000`, pass:

```bash
--api-base "http://your-host:3000"
```

Example:

```bash
npm run flickr:ingest -- \
  --selector all \
  --api-base "http://127.0.0.1:3000"
```

## Quick Start

```bash
export FLICKR_API_KEY="..."
export FLICKR_API_SECRET="..."

npm run flickr:auth

npm run flickr:ingest -- \
  --selector all \
  --limit 25 \
  -vvv
```
