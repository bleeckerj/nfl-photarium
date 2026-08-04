#!/usr/bin/env node

/**
 * Resumable folder merge for Photarium.
 *
 * Moves every image in one or more source folders into a single target folder,
 * one image at a time through PATCH /api/images/:id/update. Written for batches
 * the folder route cannot absorb: renaming 880 folders through
 * PATCH /api/folders/:name reloads the full catalog once per folder, which is
 * quadratic on a 55k-image library.
 *
 * The run is idempotent and resumable. Before writing anything it reads the
 * catalog once and skips images already sitting in the target, so a re-run after
 * an interrupt costs one catalog read and nothing else. A checkpoint file
 * records completed image IDs so a resume does not even need the catalog to
 * agree.
 *
 * Usage:
 *   node scripts/merge-folders.mjs --plan=data/reports/signals-folder-merge-plan-20260801.json --dry-run
 *   node scripts/merge-folders.mjs --plan=<file> --concurrency=4 --throttle-ms=100
 *   node scripts/merge-folders.mjs --from=blog-posts --to=blog --namespace=cf-default
 *
 * Options:
 *   --plan=<file>        Merge plan JSON (as written by the folder audit)
 *   --from=<folder>      Source folder (repeatable), when not using --plan
 *   --to=<folder>        Target folder
 *   --namespace=<ns>     Namespace scope, required with --from
 *   --api-base=<url>     Default http://localhost:3000
 *   --checkpoint-file=<f> Override the default checkpoint path
 *   --concurrency=<n>    Parallel image updates (default 4)
 *   --throttle-ms=<n>    Minimum interval between updates (default 50)
 *   --limit=<n>          Stop after n image updates (for a cautious first pass)
 *   --dry-run            Report the plan without writing
 *   --no-create-target   Skip creating the target folder registry entry
 *   -v, -vv              Verbosity
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { runWithConcurrency, createMinIntervalLimiter } from './lib/concurrency.mjs';
import { setupLogger, trace } from './lib/cliLogger.mjs';

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const paint = (color, text) => (process.stdout.isTTY ? `${color}${text}${RESET}` : text);

function parseArgs(argv) {
  const opts = {
    plan: null,
    from: [],
    to: null,
    namespace: null,
    apiBase: process.env.PHOTARIUM_API_BASE || 'http://localhost:3000',
    checkpointFile: null,
    concurrency: 4,
    throttleMs: 50,
    limit: Infinity,
    dryRun: false,
    createTarget: true,
    verbosity: 2,
  };
  for (const arg of argv) {
    if (arg.startsWith('--plan=')) opts.plan = arg.slice(7);
    else if (arg.startsWith('--from=')) opts.from.push(arg.slice(7));
    else if (arg.startsWith('--to=')) opts.to = arg.slice(5);
    else if (arg.startsWith('--namespace=')) opts.namespace = arg.slice(12);
    else if (arg.startsWith('--api-base=')) opts.apiBase = arg.slice(11).replace(/\/$/, '');
    else if (arg.startsWith('--checkpoint-file=')) opts.checkpointFile = arg.slice(18);
    else if (arg.startsWith('--concurrency=')) opts.concurrency = Number(arg.slice(14));
    else if (arg.startsWith('--throttle-ms=')) opts.throttleMs = Number(arg.slice(14));
    else if (arg.startsWith('--limit=')) opts.limit = Number(arg.slice(8));
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--no-create-target') opts.createTarget = false;
    else if (arg === '-v') opts.verbosity = 3;
    else if (arg === '-vv') opts.verbosity = 4;
    else if (arg === '-h' || arg === '--help') opts.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return opts;
}

/**
 * A merge job is a flat list of {imageId, from, namespace} plus a target. Both
 * input shapes — a plan file or --from/--to flags — reduce to this.
 */
async function buildJob(opts) {
  if (opts.plan) {
    const raw = JSON.parse(await fs.readFile(path.resolve(opts.plan), 'utf8'));
    const target = opts.to || raw.target;
    if (!target) throw new Error('Plan has no target folder and --to was not given');
    const moves = [];
    for (const source of raw.sourceFolders || []) {
      for (const imageId of source.imageIds || []) {
        moves.push({ imageId, from: source.from, namespace: source.namespace });
      }
    }
    return { target, moves, label: path.basename(opts.plan) };
  }

  if (!opts.from.length || !opts.to) {
    throw new Error('Provide --plan=<file>, or --from=<folder> --to=<folder> --namespace=<ns>');
  }
  if (!opts.namespace) throw new Error('--namespace is required with --from');

  const moves = [];
  for (const from of opts.from) {
    const members = await fetchFolderMembers(opts.apiBase, opts.namespace, from);
    members.forEach((image) => moves.push({ imageId: image.id, from, namespace: opts.namespace }));
  }
  return { target: opts.to, moves, label: `${opts.from.join('+')}->${opts.to}` };
}

/**
 * Images whose *effective* folder is `folder` in `namespace`.
 *
 * This must go through the folder-filtered query rather than a bare catalog
 * read: PATCH /api/images/:id/update stores the folder as an extras override,
 * and /api/images only merges those overrides in when a gallery parameter like
 * `folder` is present. A plain catalog read still shows the pre-move folder, so
 * using it for the resume check would re-move every image on every run.
 */
async function fetchFolderMembers(apiBase, namespace, folder) {
  const params = new URLSearchParams({ namespace, folder });
  const res = await fetch(`${apiBase}/api/images?${params}`);
  if (!res.ok) throw new Error(`Failed to read folder "${folder}" (${res.status})`);
  const payload = await res.json();
  return Array.isArray(payload) ? payload : payload.images || [];
}

function checkpointPathFor(opts, job) {
  if (opts.checkpointFile) return path.resolve(opts.checkpointFile);
  const key = createHash('sha1').update(`${job.label}\n${job.target}`).digest('hex').slice(0, 16);
  return path.resolve('data', 'folder-merge-checkpoints', `${key}.json`);
}

async function loadCheckpoint(file) {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    return { done: new Set(Array.isArray(parsed.done) ? parsed.done : []) };
  } catch {
    return { done: new Set() };
  }
}

async function saveCheckpoint(file, checkpoint, job) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const body = {
    version: 1,
    target: job.target,
    label: job.label,
    done: [...checkpoint.done].sort(),
  };
  await fs.writeFile(file, `${JSON.stringify(body, null, 1)}\n`);
}

/**
 * Folders are registered per namespace, and a plan can span several — the
 * signals plan has 879 folders in cf-signals-images and one in cf-default. The
 * target has to exist in each, not just in whichever namespace happens to sort
 * first.
 */
async function ensureTargetFolder(opts, job) {
  const namespaces = [...new Set(job.moves.map((move) => move.namespace).filter(Boolean))];
  for (const namespace of namespaces) {
    const res = await fetch(
      `${opts.apiBase}/api/folders?namespace=${encodeURIComponent(namespace)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: job.target }),
      }
    );
    if (res.ok) {
      console.log(paint(GREEN, `  created target folder "${job.target}" in ${namespace}`));
      continue;
    }
    // A folder that already exists is the normal case on a resume.
    const payload = await res.json().catch(() => ({}));
    console.log(paint(DIM, `  target folder "${job.target}" in ${namespace}: ${payload.error || res.status}`));
  }
}

async function moveImage(opts, imageId, target) {
  const res = await fetch(`${opts.apiBase}/api/images/${encodeURIComponent(imageId)}/update`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder: target }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, status: res.status, error: payload.error || `HTTP ${res.status}` };
  return { ok: true };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  setupLogger({ verbosity: opts.verbosity, color: process.stdout.isTTY });
  if (opts.help) {
    console.log(await fs.readFile(new URL(import.meta.url), 'utf8').then((s) => s.split('*/')[0]));
    return;
  }

  const job = await buildJob(opts);
  const checkpointFile = checkpointPathFor(opts, job);
  const checkpoint = await loadCheckpoint(checkpointFile);

  console.log(`Merge into ${paint(GREEN, job.target)}`);
  console.log(`  plan:       ${job.label}`);
  console.log(`  moves:      ${job.moves.length}`);
  console.log(`  checkpoint: ${checkpointFile} (${checkpoint.done.size} already recorded)`);

  // Reading the target folder's current membership — one request per namespace —
  // is what makes a re-run after an interrupt cheap, and what makes the script
  // safe to point at a plan that was partly applied by hand or by an earlier run
  // whose checkpoint was lost.
  const namespaces = [...new Set(job.moves.map((move) => move.namespace).filter(Boolean))];
  const inTarget = new Set();
  for (const namespace of namespaces) {
    const members = await fetchFolderMembers(opts.apiBase, namespace, job.target);
    members.forEach((image) => inTarget.add(image.id));
    trace(`target "${job.target}" in ${namespace}: ${members.length} images`);
  }

  const pending = [];
  let alreadyThere = 0;
  for (const move of job.moves) {
    if (checkpoint.done.has(move.imageId) || inTarget.has(move.imageId)) {
      checkpoint.done.add(move.imageId);
      alreadyThere += 1;
      continue;
    }
    pending.push(move);
  }

  console.log(`  outstanding: ${pending.length}`);
  if (alreadyThere) console.log(paint(DIM, `  already in target: ${alreadyThere}`));

  const batch = Number.isFinite(opts.limit) ? pending.slice(0, opts.limit) : pending;
  if (batch.length !== pending.length) {
    console.log(paint(YELLOW, `  limited to ${batch.length} of ${pending.length} this run`));
  }

  if (opts.dryRun) {
    const bySource = new Map();
    batch.forEach((move) => bySource.set(move.from, (bySource.get(move.from) || 0) + 1));
    console.log(paint(YELLOW, `\nDry run — no writes. ${batch.length} images across ${bySource.size} folders:`));
    [...bySource.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .forEach(([from, count]) => console.log(`  ${String(count).padStart(5)}  ${from} -> ${job.target}`));
    if (bySource.size > 20) console.log(paint(DIM, `  ... and ${bySource.size - 20} more folders`));
    return;
  }

  if (!batch.length) {
    console.log(paint(GREEN, '\nNothing to do — merge already complete.'));
    return;
  }

  if (opts.createTarget) await ensureTargetFolder(opts, job);

  const waitTurn = createMinIntervalLimiter(opts.throttleMs);
  const counts = { moved: 0, failed: 0 };
  const failures = [];
  let sinceSave = 0;

  await runWithConcurrency(batch, opts.concurrency, async (move, index) => {
    await waitTurn();
    const result = await moveImage(opts, move.imageId, job.target);
    if (result.ok) {
      counts.moved += 1;
      checkpoint.done.add(move.imageId);
      trace(`${paint(GREEN, 'moved')} ${move.imageId} ${move.from} -> ${job.target}`);
    } else {
      counts.failed += 1;
      failures.push({ imageId: move.imageId, from: move.from, error: result.error });
      console.warn(paint(RED, `  failed ${move.imageId} (${move.from}): ${result.error}`));
    }

    sinceSave += 1;
    if (sinceSave >= 25) {
      sinceSave = 0;
      await saveCheckpoint(checkpointFile, checkpoint, job);
    }
    if ((index + 1) % 100 === 0) {
      console.log(paint(DIM, `  ${index + 1}/${batch.length} processed`));
    }
  });

  await saveCheckpoint(checkpointFile, checkpoint, job);

  console.log('');
  console.log(paint(GREEN, `moved:  ${counts.moved}`));
  if (counts.failed) {
    console.log(paint(RED, `failed: ${counts.failed}`));
    failures.slice(0, 10).forEach((f) => console.log(paint(RED, `  ${f.imageId} (${f.from}): ${f.error}`)));
    console.log(paint(YELLOW, 'Re-run the same command to retry only the failures.'));
  }
  const remaining = pending.length - counts.moved;
  if (remaining > 0) {
    console.log(paint(YELLOW, `remaining: ${remaining} — re-run to continue.`));
  }
  process.exitCode = counts.failed ? 1 : 0;
}

main().catch((error) => {
  console.error(paint(RED, error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
