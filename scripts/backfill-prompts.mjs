#!/usr/bin/env node

/**
 * Backfill Prompt-This Script
 *
 * Generates and stores "Prompt This" (image-to-prompt) text for images.
 *
 * Usage:
 *   node scripts/backfill-prompts.mjs [options]
 *
 * Options:
 *   --namespace=<ns>  Only process images in this namespace (default: all)
 *   --limit=<n>       Maximum images to process (default: unlimited)
 *   --batch=<n>       Batch size before pause (default: 10)
 *   --delay=<ms>      Delay between batches in ms (default: 1000)
 *   --dry-run         Show what would be processed without doing it
 *   --force           Regenerate even if prompt already exists
 *   -v, --verbose     Show detailed progress info
 */

const API_BASE = process.env.API_BASE || 'http://localhost:3000';

const args = process.argv.slice(2);
const options = {
  namespace: null,
  limit: Infinity,
  batch: 10,
  delay: 1000,
  dryRun: false,
  force: false,
  verbose: 0,
};

for (const arg of args) {
  if (arg.startsWith('--namespace=')) {
    options.namespace = arg.split('=')[1];
  } else if (arg.startsWith('--limit=')) {
    options.limit = parseInt(arg.split('=')[1], 10);
  } else if (arg.startsWith('--batch=')) {
    options.batch = parseInt(arg.split('=')[1], 10);
  } else if (arg.startsWith('--delay=')) {
    options.delay = parseInt(arg.split('=')[1], 10);
  } else if (arg === '--dry-run') {
    options.dryRun = true;
  } else if (arg === '--force') {
    options.force = true;
  } else if (arg === '-v' || arg === '--verbose') {
    options.verbose = 1;
  } else if (arg === '--help' || arg === '-h') {
    console.log(`\nBackfill Prompt-This Script\n\nUsage:\n  node scripts/backfill-prompts.mjs [options]\n\nOptions:\n  --namespace=<ns>  Only process images in this namespace (default: all)\n  --limit=<n>       Maximum images to process (default: unlimited)\n  --batch=<n>       Batch size before pause (default: 10)\n  --delay=<ms>      Delay between batches in ms (default: 1000)\n  --dry-run         Show what would be processed without doing it\n  --force           Regenerate even if prompt already exists\n  -v, --verbose     Show detailed progress info\n\nEnv:\n  API_BASE=http://localhost:3000\n`);
    process.exit(0);
  }
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const payload = await res.json().catch(() => ({}));
  return { res, payload };
}

async function listImages() {
  const url = new URL(`${API_BASE}/api/images`);
  if (options.namespace !== null) {
    url.searchParams.set('namespace', options.namespace);
  }
  const { res, payload } = await fetchJson(url.toString());
  if (!res.ok) {
    throw new Error(payload?.error || `Failed to list images (${res.status})`);
  }
  return Array.isArray(payload?.images) ? payload.images : [];
}

async function run() {
  console.log(`[PromptThis Backfill] API_BASE=${API_BASE}`);
  console.log(`[PromptThis Backfill] namespace=${options.namespace ?? '[default]'} force=${options.force} dryRun=${options.dryRun}`);

  const images = await listImages();
  const targets = images.slice(0, Number.isFinite(options.limit) ? options.limit : images.length);
  console.log(`[PromptThis Backfill] Found ${images.length} images, processing ${targets.length}`);

  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < targets.length; i += 1) {
    const img = targets[i];
    const id = img?.id;
    if (!id) continue;

    if (options.dryRun) {
      console.log(`[DRY] Would prompt ${id} (${img?.filename || 'unknown'})`);
      continue;
    }

    const url = `${API_BASE}/api/images/${id}/prompt${options.force ? '?force=1' : ''}`;
    const { res, payload } = await fetchJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: options.force })
    });

    if (!res.ok) {
      failed += 1;
      console.warn(`[FAIL] ${id}: ${payload?.error || res.statusText}`);
    } else if (payload?.generated) {
      generated += 1;
      console.log(`[OK] ${id}: generated${payload?.saved ? '' : ' (not saved)'}`);
      if (options.verbose && payload?.record?.prompt) {
        console.log(`      ${String(payload.record.prompt).slice(0, 120)}...`);
      }
    } else {
      skipped += 1;
      console.log(`[SKIP] ${id}: already exists`);
    }

    if ((i + 1) % options.batch === 0) {
      await sleep(options.delay);
    }
  }

  console.log(`[PromptThis Backfill] Done. generated=${generated} skipped=${skipped} failed=${failed}`);
}

run().catch((err) => {
  console.error('[PromptThis Backfill] Fatal:', err);
  process.exit(1);
});
