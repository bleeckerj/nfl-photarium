#!/usr/bin/env node

/**
 * Migrate Cloudflare metadata Description/ALT into Image Extras.
 *
 * Why:
 * - Cloudflare metadata has a small size budget.
 * - Description/ALT can be long and edited often.
 * - Image Extras is the durable store for rich per-image text.
 *
 * Usage:
 *   node scripts/migrate-description-alt-to-extras.mjs [options]
 *
 * Options:
 *   --namespace=<ns>       Only process images in this namespace (default: all)
 *   --limit=<n>            Maximum images to process (default: unlimited)
 *   --batch=<n>            Batch size before pause (default: 25)
 *   --delay=<ms>           Delay between batches in ms (default: 250)
 *   --dry-run              Show what would be migrated without doing it
 *   --force                Overwrite extras even if it already has values
 *   --clear-cloudflare     After migrating, clear description/altTag from Cloudflare metadata
 *   -v, --verbose          Show detailed output
 *
 * Env:
 *   API_BASE=http://localhost:3000
 */

const API_BASE = process.env.API_BASE || 'http://localhost:3000';

const args = process.argv.slice(2);
const options = {
  namespace: null,
  limit: Infinity,
  batch: 25,
  delay: 250,
  dryRun: false,
  force: false,
  clearCloudflare: false,
  verbose: 0
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
  } else if (arg === '--clear-cloudflare') {
    options.clearCloudflare = true;
  } else if (arg === '-v' || arg === '--verbose') {
    options.verbose = 1;
  } else if (arg === '--help' || arg === '-h') {
    console.log(`\nMigrate Description/ALT to Extras\n\nUsage:\n  node scripts/migrate-description-alt-to-extras.mjs [options]\n\nOptions:\n  --namespace=<ns>       Only process images in this namespace (default: all)\n  --limit=<n>            Maximum images to process (default: unlimited)\n  --batch=<n>            Batch size before pause (default: 25)\n  --delay=<ms>           Delay between batches in ms (default: 250)\n  --dry-run              Show what would be migrated without doing it\n  --force                Overwrite extras even if it already has values\n  --clear-cloudflare     After migrating, clear description/altTag from Cloudflare metadata\n  -v, --verbose          Show detailed output\n\nEnv:\n  API_BASE=http://localhost:3000\n`);
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

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

async function run() {
  console.log(`[Extras Migration] API_BASE=${API_BASE}`);
  console.log(`[Extras Migration] namespace=${options.namespace ?? '[default]'} force=${options.force} dryRun=${options.dryRun} clearCloudflare=${options.clearCloudflare}`);

  const images = await listImages();
  const targets = images.slice(0, Number.isFinite(options.limit) ? options.limit : images.length);
  console.log(`[Extras Migration] Found ${images.length} images, processing ${targets.length}`);

  let migrated = 0;
  let skipped = 0;
  let cleared = 0;
  let failed = 0;

  for (let i = 0; i < targets.length; i += 1) {
    const img = targets[i];
    const id = img?.id;
    if (!id) continue;

    const cfDescription = img?.description;
    const cfAlt = img?.altTag;

    const shouldConsider = hasText(cfDescription) || hasText(cfAlt);
    if (!shouldConsider) {
      skipped += 1;
      continue;
    }

    const extrasUrl = `${API_BASE}/api/images/${id}/extras`;
    const { res: extrasRes, payload: extrasPayload } = await fetchJson(extrasUrl);
    if (!extrasRes.ok) {
      failed += 1;
      console.warn(`[FAIL] ${id}: extras GET ${extrasRes.status} ${extrasPayload?.error || extrasRes.statusText}`);
      continue;
    }

    const current = extrasPayload?.record || null;
    const existingDescription = current?.description;
    const existingAltText = current?.altText;

    const needsDescription = hasText(cfDescription) && (!hasText(existingDescription) || options.force);
    const needsAltText = hasText(cfAlt) && (!hasText(existingAltText) || options.force);

    if (!needsDescription && !needsAltText) {
      skipped += 1;
      continue;
    }

    if (options.dryRun) {
      console.log(`[DRY] Would migrate ${id}: ${needsDescription ? 'description ' : ''}${needsAltText ? 'altText' : ''}`);
      continue;
    }

    const patchBody = {};
    if (needsDescription) patchBody.description = cfDescription;
    if (needsAltText) patchBody.altText = cfAlt;

    const { res: patchRes, payload: patchPayload } = await fetchJson(extrasUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patchBody)
    });

    if (!patchRes.ok) {
      failed += 1;
      console.warn(`[FAIL] ${id}: extras PATCH ${patchRes.status} ${patchPayload?.error || patchRes.statusText}`);
      continue;
    }

    migrated += 1;
    if (options.verbose) {
      console.log(`[OK] ${id}: migrated${options.force ? ' (forced)' : ''}`);
    }

    if (options.clearCloudflare) {
      const updateUrl = `${API_BASE}/api/images/${id}/update`;
      const { res: updateRes, payload: updatePayload } = await fetchJson(updateUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: '',
          altTag: ''
        })
      });

      if (!updateRes.ok) {
        console.warn(`[WARN] ${id}: migrated but failed to clear Cloudflare fields (${updateRes.status}): ${updatePayload?.error || updateRes.statusText}`);
      } else {
        cleared += 1;
      }
    }

    if ((i + 1) % options.batch === 0) {
      await sleep(options.delay);
    }
  }

  console.log(`[Extras Migration] Done. migrated=${migrated} cleared=${cleared} skipped=${skipped} failed=${failed}`);
}

run().catch((err) => {
  console.error('[Extras Migration] Fatal:', err);
  process.exit(1);
});
