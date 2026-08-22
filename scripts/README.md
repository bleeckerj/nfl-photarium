# Operational Scripts

## Responsibilities

- Top-level scripts are CLI entrypoints that parse arguments, call reusable modules, and print readable operator output.
- Shared script logic should move to narrowly named modules under `scripts/<workflow>/` or `scripts/lib/`.

## Public Entrypoints

- Preserve command names in `package.json`.
- Keep behavior-compatible wrappers when splitting a legacy script into `cli.mjs`, `config.mjs`, provider/client modules, pipeline modules, and reporter modules.

## Sora Video Extensions

Run the extension helper with the OpenAI SDK through `uv`:

```sh
uv run --with openai python scripts/sora_extend.py \
  --id video_123 \
  --prompt-file /path/to/continuation.txt \
  --seconds 12 \
  --expected-size 1280x720 \
  --out out/sora/extended.mp4 \
  --json-out out/sora/extended.json
```

Extensions inherit the completed source video's dimensions. Choose `--size` when creating the original clip; use `--expected-size` here as a guard against extending the wrong source. Use `--dry-run` to inspect the request without an API call.

## Relevant Tests

- `__tests__/instagramIngestScript.test.ts`
- `__tests__/snagitIngestScript.test.ts`
- `__tests__/fsIngestScript.test.ts`
- `__tests__/missingNamespaceAssignment.test.ts`

## Do Not Add

- Do not hide mutation decisions behind terse logs.
- Do not duplicate provider clients across ingest scripts.
- Do not put secrets in examples, fixtures, stdout, screenshots, or command strings.
