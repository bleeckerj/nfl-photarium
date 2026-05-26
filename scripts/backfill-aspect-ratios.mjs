#!/usr/bin/env node
/**
 * Compatibility wrapper for the old aspect-ratio backfill command.
 *
 * The canonical implementation is scripts/backfill-image-metadata.ts, which
 * persists image dimensions through src/server/vectorSearch.ts.
 */

import { spawnSync } from 'node:child_process';

const result = spawnSync(
  process.execPath,
  ['--import', 'tsx', './scripts/backfill-image-metadata.ts', ...process.argv.slice(2)],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  }
);

if (result.error) {
  console.error(result.error instanceof Error ? result.error.message : result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
