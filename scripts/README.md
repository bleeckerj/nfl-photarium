# Operational Scripts

## Responsibilities

- Top-level scripts are CLI entrypoints that parse arguments, call reusable modules, and print readable operator output.
- Shared script logic should move to narrowly named modules under `scripts/<workflow>/` or `scripts/lib/`.

## Public Entrypoints

- Preserve command names in `package.json`.
- Keep behavior-compatible wrappers when splitting a legacy script into `cli.mjs`, `config.mjs`, provider/client modules, pipeline modules, and reporter modules.

## Relevant Tests

- `__tests__/instagramIngestScript.test.ts`
- `__tests__/snagitIngestScript.test.ts`
- `__tests__/fsIngestScript.test.ts`
- `__tests__/missingNamespaceAssignment.test.ts`

## Do Not Add

- Do not hide mutation decisions behind terse logs.
- Do not duplicate provider clients across ingest scripts.
- Do not put secrets in examples, fixtures, stdout, screenshots, or command strings.
