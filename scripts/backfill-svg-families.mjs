#!/usr/bin/env node

/**
 * Backfill SVG pairs onto the WebP-parent / SVG-variant shape.
 *
 * SVGs used to be uploaded as two unrelated sibling records: the vector original
 * and a rasterized WebP companion, cross-linked only by `linkedAssetId`. That
 * doubled every SVG in the gallery, and the companion inherited the parent's
 * metadata verbatim — so it claimed `type: image/svg+xml` and the SVG's byte size.
 *
 * New uploads land correctly (see uploadService.ts). This repairs the existing ones:
 *
 *   1. re-parent the SVG to its companion, so the pair collapses to one canonical
 *      entry and the family head is natively raster
 *   2. correct the companion's `type` and `size` to describe the WebP itself
 *
 * Families are flat (src/server/imageFamily.ts), so an SVG that already sits under
 * some other parent is left alone rather than being pushed into a two-level chain.
 *
 * Idempotent: re-running after a completed pass reads the catalog and writes nothing.
 * Metadata and embedding generation for the repaired parents is deliberately left to
 * the existing backfill scripts (backfill-embeddings.mjs, backfill-prompts.mjs),
 * which already handle batching, throttling and resume.
 *
 * Usage:
 *   node scripts/backfill-svg-families.mjs                 # dry run, reports the plan
 *   node scripts/backfill-svg-families.mjs --apply         # perform the writes
 *   node scripts/backfill-svg-families.mjs --apply --limit=5
 *
 * Options:
 *   --apply          Perform writes. Without it the script only reports.
 *   --limit=<n>      Stop after n repaired pairs.
 *   --throttle-ms=<n> Minimum interval between writes (default 100)
 */

import fs from 'node:fs';
import path from 'node:path';

const CF_API = 'https://api.cloudflare.com/client/v4';

/**
 * Read .env.local into process.env.
 *
 * Next.js loads these itself, but a standalone node script does not — and
 * `source .env.local` only creates shell variables, which are never exported to
 * child processes. Same helper as backfill-comfy-metadata.mjs. Real environment
 * variables win, so `CLOUDFLARE_API_TOKEN=... node scripts/...` still overrides.
 */
const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf-8');
  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq === -1) return;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  });
};

loadEnvFile(path.resolve(process.cwd(), '.env.local'));
loadEnvFile(path.resolve(process.cwd(), '.env'));

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(`--${name}`);
const readOption = (name, fallback) => {
  const hit = args.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const APPLY = hasFlag('apply');
const LIMIT = Number(readOption('limit', '0')) || Infinity;
const THROTTLE_MS = Number(readOption('throttle-ms', '100')) || 0;

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
if (!accountId || !apiToken) {
  console.error(
    'Missing CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN.\n' +
      'Expected them in .env.local (loaded automatically) or the environment.\n' +
      'Note: `source .env.local` alone will not work — those entries have no `export`,\n' +
      'so they stay shell variables and are never passed to node.'
  );
  process.exit(1);
}

const authHeaders = { Authorization: `Bearer ${apiToken}` };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isSvgName = (name) => typeof name === 'string' && name.toLowerCase().endsWith('.svg');

async function listAllImages() {
  const images = [];
  for (let page = 1; ; page += 1) {
    const response = await fetch(
      `${CF_API}/accounts/${accountId}/images/v1?page=${page}&per_page=1000`,
      { headers: authHeaders }
    );
    const payload = await response.json();
    if (!payload.success) {
      throw new Error(`Cloudflare list failed: ${JSON.stringify(payload.errors)}`);
    }
    const batch = payload.result?.images ?? [];
    images.push(...batch);
    if (batch.length < 1000) break;
  }
  return images;
}

async function patchMetadata(imageId, metadata) {
  const response = await fetch(`${CF_API}/accounts/${accountId}/images/v1/${imageId}`, {
    method: 'PATCH',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ metadata }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    throw new Error(`PATCH ${imageId} failed: ${JSON.stringify(payload.errors ?? payload)}`);
  }
  return payload.result;
}

/** Byte length of the stored WebP, read from the delivery URL rather than trusted metadata. */
async function measureVariant(image) {
  const url = (image.variants ?? []).find((v) => v.includes('/public')) ?? image.variants?.[0];
  if (!url) return undefined;
  try {
    const head = await fetch(url, { method: 'HEAD' });
    const length = Number(head.headers.get('content-length'));
    return Number.isFinite(length) && length > 0 ? length : undefined;
  } catch {
    return undefined;
  }
}

async function main() {
  console.log(APPLY ? 'Mode: APPLY (writing)' : 'Mode: DRY RUN (no writes) — pass --apply to write');

  const images = await listAllImages();
  const byId = new Map(images.map((image) => [image.id, image]));
  const svgs = images.filter((image) => isSvgName(image.filename));
  console.log(`Catalog: ${images.length} images, ${svgs.length} SVG records`);

  let repaired = 0;
  let alreadyCorrect = 0;
  const skipped = [];

  for (const svg of svgs) {
    if (repaired >= LIMIT) break;

    const meta = svg.meta ?? {};
    const companionId = typeof meta.linkedAssetId === 'string' ? meta.linkedAssetId.trim() : '';
    if (!companionId) {
      skipped.push({ id: svg.id, reason: 'no linkedAssetId (unpaired legacy SVG)' });
      continue;
    }
    const companion = byId.get(companionId);
    if (!companion) {
      skipped.push({ id: svg.id, reason: `companion ${companionId} not in catalog` });
      continue;
    }

    const currentParent = typeof meta.variationParentId === 'string' ? meta.variationParentId.trim() : '';
    // Flat families: an SVG already under another root stays there rather than being
    // pushed into a svg -> webp -> root chain the model cannot represent.
    if (currentParent && currentParent !== companionId) {
      skipped.push({ id: svg.id, reason: `already parented to ${currentParent}` });
      continue;
    }

    const parentNeedsFix = currentParent !== companionId;
    const companionMeta = companion.meta ?? {};
    const companionTypeWrong = companionMeta.type !== 'image/webp';
    // The old code copied the parent's metadata wholesale, so a companion whose
    // recorded size matches the SVG's is carrying the vector's byte count.
    const companionSizeWrong =
      companionMeta.size !== undefined &&
      meta.size !== undefined &&
      String(companionMeta.size) === String(meta.size);

    if (!parentNeedsFix && !companionTypeWrong && !companionSizeWrong) {
      alreadyCorrect += 1;
      continue;
    }

    const actions = [];
    if (parentNeedsFix) actions.push(`parent ${svg.id} -> ${companionId}`);
    if (companionTypeWrong) actions.push(`companion type -> image/webp`);
    if (companionSizeWrong) actions.push(`companion size -> measured`);
    console.log(`${APPLY ? 'FIX ' : 'PLAN'} ${svg.filename}: ${actions.join('; ')}`);

    if (APPLY) {
      if (parentNeedsFix) {
        await patchMetadata(svg.id, {
          ...meta,
          variationParentId: companionId,
          updatedAt: new Date().toISOString(),
        });
      }
      if (companionTypeWrong || companionSizeWrong) {
        const measured = await measureVariant(companion);
        await patchMetadata(companion.id, {
          ...companionMeta,
          type: 'image/webp',
          ...(measured ? { size: measured } : {}),
          updatedAt: new Date().toISOString(),
        });
      }
      if (THROTTLE_MS) await sleep(THROTTLE_MS);
    }

    repaired += 1;
  }

  console.log('');
  console.log(`${APPLY ? 'Repaired' : 'Would repair'}: ${repaired}`);
  console.log(`Already correct: ${alreadyCorrect}`);
  if (skipped.length) {
    console.log(`Skipped: ${skipped.length}`);
    for (const entry of skipped.slice(0, 20)) {
      console.log(`  ${entry.id}: ${entry.reason}`);
    }
    if (skipped.length > 20) console.log(`  ... and ${skipped.length - 20} more`);
  }
  if (!APPLY && repaired > 0) {
    console.log('\nRe-run with --apply to write these changes.');
  }
  if (APPLY && repaired > 0) {
    console.log('\nNext: generate metadata and embeddings for the repaired parents, e.g.');
    console.log('  node scripts/backfill-embeddings.mjs');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
