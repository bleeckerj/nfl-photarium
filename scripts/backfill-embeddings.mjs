#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  colorBlocksRow, createEntryBase, createLogger, fetchImages, fetchLiveEmbeddingStatus,
  formatDuration, loadCheckpoint, needsEmbedding, postEmbeddings, requestedModeLabel,
  resumeEntrySatisfiesRequest, liveStateSatisfiesRequest, saveCheckpoint,
} from './embeddingBackfillSupport.mjs';
export { liveStateSatisfiesRequest, resumeEntrySatisfiesRequest } from './embeddingBackfillSupport.mjs';

const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const DEFAULT_BATCH = 10;
const DEFAULT_DELAY_MS = 1000;
const DEFAULT_THROTTLE_MS = 150;
const DEFAULT_HEARTBEAT_MS = 5000;
const DEFAULT_CHECKPOINT_DIR = path.resolve('data', 'embedding-backfill-checkpoints');
const SCRIPT_PATH = fileURLToPath(import.meta.url);

const HELP_TEXT = `
Backfill Embeddings Script

Creates missing CLIP and/or color embeddings across the image catalog.
The job is sequential, throttled, and resumable via a JSON checkpoint file.

Usage:
  npm run embeddings:backfill -- [options]
  node scripts/backfill-embeddings.mjs [options]

Options:
  --namespace=<ns>          Only process images in this namespace
                            Use "__all__" for every namespace
                            Use "__none__" for images with no namespace
  --limit=<n>               Maximum actionable images to process this run
  --batch=<n>               Pause after every N processed images (default: ${DEFAULT_BATCH})
  --delay=<ms>              Delay between batches in ms (default: ${DEFAULT_DELAY_MS})
  --throttle-ms=<ms>        Minimum delay between image requests (default: ${DEFAULT_THROTTLE_MS})
  --clip-only               Only generate CLIP embeddings
  --color-only              Only generate color embeddings
  --dry-run                 Print the actionable worklist without processing
  --force                   Re-generate even if embeddings already exist
  --checkpoint-dir=<path>   Directory for generated checkpoint files
  --checkpoint-file=<path>  Explicit checkpoint file path
  --resume                  Resume from checkpoint state (default)
  --no-resume               Ignore existing checkpoint state
  --refresh                 Force a fresh /api/images cache refresh
  --no-refresh              Reuse cached /api/images state (default)
  --catalog-vector-meta     Ask /api/images to re-enrich list items from Redis before filtering
  --no-catalog-vector-meta  Skip Redis enrichment on the initial catalog pass (default)
  --live-verify             Batch-verify embedding status from Redis before counting work (default)
  --no-live-verify          Skip Redis verification and trust catalog flags only
  --heartbeat-ms=<ms>       Emit "still waiting" logs while requests are in flight (default: ${DEFAULT_HEARTBEAT_MS})
  -v                        Verbose logs
  -vv                       Request/response timing logs
  -vvv                      Detailed filtering and checkpoint logs
  -vvvv                     Trace payload summaries
  -vvvvv                    Very noisy checkpoint/request dumps
  --verbose=<n>             Set verbosity level explicitly (0-5)
  --help, -h                Show this help

Examples:
  npm run embeddings:backfill -- --namespace=cf-default
  npm run embeddings:backfill -- --limit=250 --throttle-ms=300 --batch=20 --delay=2000 -vv
  npm run embeddings:backfill -- --color-only --checkpoint-file ./data/embedding-backfill-checkpoints/color-pass.json
  npm run embeddings:backfill -- --force --resume -vvvvv
`.trim();

const nowIso = () => new Date().toISOString();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parseInteger = (value, flagName, { min = 0, allowInfinity = false } = {}) => {
  if (allowInfinity && (value === 'Infinity' || value === 'inf')) {
    return Infinity;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < min) {
    throw new Error(`Invalid value for ${flagName}: ${value}`);
  }
  return parsed;
};

const normalizeNamespace = (raw) => {
  if (raw === undefined || raw === null) return '__all__';
  const trimmed = String(raw).trim();
  if (!trimmed || trimmed === '__all__') return '__all__';
  if (trimmed === '__none__') return '';
  return trimmed;
};

const sanitizePathSegment = (value) => {
  if (value === '__all__') return 'all';
  if (value === '') return 'none';
  return String(value)
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96) || 'default';
};

export function defaultCheckpointPath(options) {
  const mode = options.clipOnly ? 'clip' : options.colorOnly ? 'color' : 'clip-color';
  const forceMode = options.force ? 'force' : 'missing';
  const namespacePart = sanitizePathSegment(options.namespace);
  return path.resolve(
    options.checkpointDir || DEFAULT_CHECKPOINT_DIR,
    `embedding-backfill.${namespacePart}.${mode}.${forceMode}.json`
  );
}

export function parseArgs(rawArgs) {
  const options = {
    namespace: '__all__',
    limit: Infinity,
    batch: DEFAULT_BATCH,
    delay: DEFAULT_DELAY_MS,
    throttleMs: DEFAULT_THROTTLE_MS,
    heartbeatMs: DEFAULT_HEARTBEAT_MS,
    clipOnly: false,
    colorOnly: false,
    dryRun: false,
    force: false,
    verbose: 0,
    checkpointDir: DEFAULT_CHECKPOINT_DIR,
    checkpointFile: '',
    resume: true,
    refresh: false,
    includeVectorMeta: false,
    liveVerify: true,
    help: false,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    const next = rawArgs[index + 1];

    if (/^-v{1,5}$/.test(arg)) {
      options.verbose = Math.max(options.verbose, arg.length - 1);
      continue;
    }
    if (arg === '--verbose') {
      options.verbose = Math.max(options.verbose, 1);
      continue;
    }
    if (arg.startsWith('--verbose=')) {
      options.verbose = Math.max(0, Math.min(5, parseInteger(arg.split('=')[1], '--verbose', { min: 0 })));
      continue;
    }
    if (arg === '--namespace' && next) {
      options.namespace = normalizeNamespace(next);
      index += 1;
      continue;
    }
    if (arg.startsWith('--namespace=')) {
      options.namespace = normalizeNamespace(arg.split('=').slice(1).join('='));
      continue;
    }
    if (arg === '--limit' && next) {
      options.limit = parseInteger(next, '--limit', { min: 1, allowInfinity: true });
      index += 1;
      continue;
    }
    if (arg.startsWith('--limit=')) {
      options.limit = parseInteger(arg.split('=')[1], '--limit', { min: 1, allowInfinity: true });
      continue;
    }
    if (arg === '--batch' && next) {
      options.batch = parseInteger(next, '--batch', { min: 1 });
      index += 1;
      continue;
    }
    if (arg.startsWith('--batch=')) {
      options.batch = parseInteger(arg.split('=')[1], '--batch', { min: 1 });
      continue;
    }
    if (arg === '--delay' && next) {
      options.delay = parseInteger(next, '--delay', { min: 0 });
      index += 1;
      continue;
    }
    if (arg.startsWith('--delay=')) {
      options.delay = parseInteger(arg.split('=')[1], '--delay', { min: 0 });
      continue;
    }
    if (arg === '--throttle-ms' && next) {
      options.throttleMs = parseInteger(next, '--throttle-ms', { min: 0 });
      index += 1;
      continue;
    }
    if (arg.startsWith('--throttle-ms=')) {
      options.throttleMs = parseInteger(arg.split('=')[1], '--throttle-ms', { min: 0 });
      continue;
    }
    if (arg === '--checkpoint-dir' && next) {
      options.checkpointDir = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg.startsWith('--checkpoint-dir=')) {
      options.checkpointDir = path.resolve(arg.split('=').slice(1).join('='));
      continue;
    }
    if (arg === '--checkpoint-file' && next) {
      options.checkpointFile = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg.startsWith('--checkpoint-file=')) {
      options.checkpointFile = path.resolve(arg.split('=').slice(1).join('='));
      continue;
    }
    if (arg === '--clip-only') {
      options.clipOnly = true;
      continue;
    }
    if (arg === '--color-only') {
      options.colorOnly = true;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--force') {
      options.force = true;
      continue;
    }
    if (arg === '--resume') {
      options.resume = true;
      continue;
    }
    if (arg === '--no-resume') {
      options.resume = false;
      continue;
    }
    if (arg === '--refresh') {
      options.refresh = true;
      continue;
    }
    if (arg === '--no-refresh') {
      options.refresh = false;
      continue;
    }
    if (arg === '--catalog-vector-meta') {
      options.includeVectorMeta = true;
      continue;
    }
    if (arg === '--no-catalog-vector-meta') {
      options.includeVectorMeta = false;
      continue;
    }
    if (arg === '--heartbeat-ms' && next) {
      options.heartbeatMs = parseInteger(next, '--heartbeat-ms', { min: 250 });
      index += 1;
      continue;
    }
    if (arg.startsWith('--heartbeat-ms=')) {
      options.heartbeatMs = parseInteger(arg.split('=')[1], '--heartbeat-ms', { min: 250 });
      continue;
    }
    if (arg === '--live-verify') {
      options.liveVerify = true;
      continue;
    }
    if (arg === '--no-live-verify') {
      options.liveVerify = false;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.clipOnly && options.colorOnly) {
    throw new Error('Cannot combine --clip-only and --color-only');
  }

  options.checkpointFile = options.checkpointFile || defaultCheckpointPath(options);
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP_TEXT);
    return;
  }

  const log = createLogger(options);
  const generateClip = !options.colorOnly;
  const generateColor = !options.clipOnly;

  log.info('============================================================');
  log.info('Embeddings Backfill');
  log.info('============================================================');
  log.info(`API base:            ${API_BASE}`);
  log.info(`Namespace:           ${options.namespace === '__all__' ? 'all' : options.namespace === '' ? '(none)' : options.namespace}`);
  log.info(`Requested mode:      ${requestedModeLabel(generateClip, generateColor)}`);
  log.info(`Force regenerate:    ${options.force}`);
  log.info(`Resume checkpoint:   ${options.resume}`);
  log.info(`Checkpoint file:     ${options.checkpointFile}`);
  log.info(`Throttle ms:         ${options.throttleMs}`);
  log.info(`Batch size:          ${options.batch}`);
  log.info(`Batch delay ms:      ${options.delay}`);
  log.info(`Heartbeat ms:        ${options.heartbeatMs}`);
  log.info(`Refresh catalog:     ${options.refresh}`);
  log.info(`Catalog vector meta: ${options.includeVectorMeta}`);
  log.info(`Live verify:         ${options.liveVerify}`);
  log.info(`Dry run:             ${options.dryRun}`);
  log.info(`Verbosity:           ${options.verbose}`);
  log.info('============================================================');

  const checkpoint = await loadCheckpoint(options.checkpointFile, options, generateClip, generateColor, log);
  const checkpointSummary = summarizeCheckpoint(checkpoint);
  if (checkpointSummary.total > 0) {
    log.info(
      `Checkpoint summary: success=${checkpointSummary.success} skipped=${checkpointSummary.skipped} failed=${checkpointSummary.failed} running=${checkpointSummary.running}`
    );
  }

  checkpoint.summary.lastRunStartedAt = nowIso();
  await saveCheckpoint(options.checkpointFile, checkpoint, log);

  const allAssets = await fetchImages(options, log);
  const imageAssets = allAssets.filter((asset) => asset.assetType !== 'video');
  const videoCount = allAssets.length - imageAssets.length;
  log.info(`Catalog assets:       ${allAssets.length}`);
  log.info(`Image assets:         ${imageAssets.length}`);
  if (videoCount > 0) {
    log.info(`Skipped videos:       ${videoCount}`);
  }

  const cacheWithClip = imageAssets.filter((img) => img.hasClipEmbedding).length;
  const cacheWithColor = imageAssets.filter((img) => img.hasColorEmbedding).length;
  const cacheWithBoth = imageAssets.filter((img) => img.hasClipEmbedding && img.hasColorEmbedding).length;
  const cacheWithNeither = imageAssets.filter((img) => !img.hasClipEmbedding && !img.hasColorEmbedding).length;
  log.info(`Cache With CLIP:      ${cacheWithClip}`);
  log.info(`Cache With color:     ${cacheWithColor}`);
  log.info(`Cache With both:      ${cacheWithBoth}`);
  log.info(`Cache With neither:   ${cacheWithNeither}`);

  const {
    images: verifiedImages,
    driftClip,
    driftColor,
  } = await fetchLiveEmbeddingStatus(imageAssets, options, log);

  const withClip = verifiedImages.filter((img) => img.hasClipEmbedding).length;
  const withColor = verifiedImages.filter((img) => img.hasColorEmbedding).length;
  const withBoth = verifiedImages.filter((img) => img.hasClipEmbedding && img.hasColorEmbedding).length;
  const withNeither = verifiedImages.filter((img) => !img.hasClipEmbedding && !img.hasColorEmbedding).length;
  if (options.liveVerify) {
    log.info(`Live With CLIP:       ${withClip}`);
    log.info(`Live With color:      ${withColor}`);
    log.info(`Live With both:       ${withBoth}`);
    log.info(`Live With neither:    ${withNeither}`);
    log.info(`Clip drift count:     ${driftClip}`);
    log.info(`Color drift count:    ${driftColor}`);
  }

  const needsWork = verifiedImages.filter((image) => needsEmbedding(image, options));
  let resumedEntriesSkipped = 0;
  let liveSatisfiedSkipped = 0;

  const actionable = [];
  for (const image of needsWork) {
    const entry = checkpoint.entries?.[image.id];
    const resumeSatisfied = options.resume && resumeEntrySatisfiesRequest(entry, options);
    const liveSatisfied = liveStateSatisfiesRequest(image, options);

    if (resumeSatisfied) {
      resumedEntriesSkipped += 1;
      log.trace(`resume-skip image=${image.id} filename=${image.filename}`);
      continue;
    }

    if (!options.force && liveSatisfied) {
      liveSatisfiedSkipped += 1;
      log.trace(`live-skip image=${image.id} filename=${image.filename}`);
      continue;
    }

    actionable.push(image);
  }

  const worklist = Number.isFinite(options.limit)
    ? actionable.slice(0, options.limit)
    : actionable;

  checkpoint.summary.resumedEntriesSkipped = resumedEntriesSkipped;
  checkpoint.summary.liveSatisfiedSkipped = liveSatisfiedSkipped;
  await saveCheckpoint(options.checkpointFile, checkpoint, log);

  log.info(`Needs embeddings now: ${needsWork.length}`);
  log.info(`Resume-skipped:       ${resumedEntriesSkipped}`);
  log.info(`Live-state skipped:   ${liveSatisfiedSkipped}`);
  log.info(`Actionable this run:  ${worklist.length}`);

  if (worklist.length === 0) {
    log.info('Nothing to do. The catalog already satisfies the requested embedding mode.');
    checkpoint.summary.lastRunFinishedAt = nowIso();
    checkpoint.summary.lastOutcome = 'no-op';
    await saveCheckpoint(options.checkpointFile, checkpoint, log);
    return;
  }

  if (options.dryRun) {
    log.info('');
    log.info('[dry-run] Actionable images:');
    for (const image of worklist.slice(0, 100)) {
      const clipStatus = image.hasClipEmbedding ? 'ready' : 'missing';
      const colorStatus = image.hasColorEmbedding ? 'ready' : 'missing';
      log.info(`  ${image.id} | clip=${clipStatus} color=${colorStatus} | ${image.filename}`);
    }
    if (worklist.length > 100) {
      log.info(`  ... plus ${worklist.length - 100} more`);
    }
    checkpoint.summary.lastRunFinishedAt = nowIso();
    checkpoint.summary.lastOutcome = 'dry-run';
    await saveCheckpoint(options.checkpointFile, checkpoint, log);
    return;
  }

  const runStartedAt = Date.now();
  let processedThisRun = 0;
  let successThisRun = 0;
  let skippedThisRun = 0;
  let failedThisRun = 0;
  const errors = [];
  const timings = [];
  let lastRequestStartedAt = 0;

  for (let index = 0; index < worklist.length; index += 1) {
    const image = worklist[index];
    const previousEntry = checkpoint.entries?.[image.id];
    const baseEntry = createEntryBase(image, options, generateClip, generateColor, previousEntry);

    checkpoint.entries[image.id] = {
      ...previousEntry,
      ...baseEntry,
      status: 'running',
      startedAt: nowIso(),
    };
    await saveCheckpoint(options.checkpointFile, checkpoint, log);

    const progress = `[${String(index + 1).padStart(String(worklist.length).length, ' ')}/${worklist.length}]`;
    const pct = (((index + 1) / worklist.length) * 100).toFixed(1).padStart(5, ' ');
    const shortName = image.filename.length > 42 ? `${image.filename.slice(0, 39)}...` : image.filename;
    process.stdout.write(`${progress} ${pct}% ${shortName.padEnd(42, ' ')} `);

    if (options.throttleMs > 0) {
      const waitMs = options.throttleMs - (Date.now() - lastRequestStartedAt);
      if (waitMs > 0) {
        log.trace(`throttle-sleep image=${image.id} waitMs=${waitMs}`);
        await sleep(waitMs);
      }
    }

    try {
      lastRequestStartedAt = Date.now();
      const { payload, status, elapsedMs } = await postEmbeddings(
        image.id,
        generateClip,
        generateColor,
        options.force,
        log
      );
      timings.push(elapsedMs);

      const clipReady = Boolean(payload?.hasClipEmbedding) || Boolean(image.hasClipEmbedding);
      const colorReady = Boolean(payload?.hasColorEmbedding) || Boolean(image.hasColorEmbedding);
      const generatedParts = [];
      if (payload?.clipGenerated) generatedParts.push('CLIP');
      if (payload?.colorGenerated) generatedParts.push('color');
      const statusLabel = payload?.skipped ? 'skip' : generatedParts.length ? generatedParts.join('+') : 'updated';
      const imageTimeStr = `${(elapsedMs / 1000).toFixed(1)}s`;
      const totalElapsed = Date.now() - runStartedAt;
      const recentTimings = timings.slice(-10);
      const averageMs = recentTimings.reduce((sum, value) => sum + value, 0) / recentTimings.length;
      const remaining = worklist.length - (index + 1);
      const etaStr = remaining > 0 ? formatDuration(averageMs * remaining) : 'done';

      checkpoint.entries[image.id] = {
        ...checkpoint.entries[image.id],
        status: payload?.skipped ? 'skipped' : 'success',
        clipGenerated: Boolean(payload?.clipGenerated),
        colorGenerated: Boolean(payload?.colorGenerated),
        clipReady,
        colorReady,
        lastDurationMs: elapsedMs,
        lastHttpStatus: status,
        lastError: null,
        completedAt: nowIso(),
        updatedAt: nowIso(),
      };
      checkpoint.summary.lastProcessedImageId = image.id;
      checkpoint.summary.lastProcessedFilename = image.filename;
      checkpoint.summary.lastOutcome = payload?.skipped ? 'skipped' : 'success';
      await saveCheckpoint(options.checkpointFile, checkpoint, log);

      const colorPreview = Array.isArray(payload?.dominantColors) ? ` ${colorBlocksRow(payload.dominantColors)}` : '';
      process.stdout.write(`${statusLabel} (${imageTimeStr})${colorPreview} | total=${formatDuration(totalElapsed)} | eta=${etaStr}\n`);

      if (payload?.skipped) {
        skippedThisRun += 1;
      } else {
        successThisRun += 1;
      }
      processedThisRun += 1;
    } catch (error) {
      const elapsedMs = Math.max(1, Date.now() - lastRequestStartedAt);
      timings.push(elapsedMs);
      const status = error && typeof error === 'object' && 'status' in error ? error.status : null;
      const payload = error && typeof error === 'object' && 'payload' in error ? error.payload : null;
      const message = error instanceof Error ? error.message : String(error);

      checkpoint.entries[image.id] = {
        ...checkpoint.entries[image.id],
        status: 'failed',
        lastDurationMs: elapsedMs,
        lastHttpStatus: status,
        lastError: message,
        completedAt: nowIso(),
        updatedAt: nowIso(),
      };
      checkpoint.summary.lastProcessedImageId = image.id;
      checkpoint.summary.lastProcessedFilename = image.filename;
      checkpoint.summary.lastOutcome = 'failed';
      await saveCheckpoint(options.checkpointFile, checkpoint, log);

      process.stdout.write(`FAILED (${(elapsedMs / 1000).toFixed(1)}s)\n`);
      log.info(`  error image=${image.id} status=${status ?? 'n/a'} message=${message}`);
      if (payload) {
        log.dump('  error payload:', payload);
      }

      failedThisRun += 1;
      processedThisRun += 1;
      errors.push({ imageId: image.id, filename: image.filename, message, status });
    }

    if ((index + 1) % options.batch === 0 && index + 1 < worklist.length && options.delay > 0) {
      const elapsed = Date.now() - runStartedAt;
      const rate = processedThisRun > 0 ? processedThisRun / (elapsed / 1000) : 0;
      const remaining = worklist.length - processedThisRun;
      const recentTimings = timings.slice(-10);
      const averageMs = recentTimings.length
        ? recentTimings.reduce((sum, value) => sum + value, 0) / recentTimings.length
        : 0;

      log.info('------------------------------------------------------------');
      log.info(`Batch pause after ${processedThisRun} images`);
      log.info(`Succeeded: ${successThisRun} | Skipped: ${skippedThisRun} | Failed: ${failedThisRun}`);
      log.info(`Rate: ${rate.toFixed(2)} images/sec | Avg: ${(averageMs / 1000).toFixed(2)}s/image`);
      log.info(`Remaining: ${remaining} | ETA: ${averageMs > 0 ? formatDuration(averageMs * remaining) : 'n/a'}`);
      log.info(`Sleeping ${options.delay}ms before continuing`);
      log.info('------------------------------------------------------------');
      await sleep(options.delay);
    }
  }

  const totalTime = Date.now() - runStartedAt;
  checkpoint.summary.lastRunFinishedAt = nowIso();
  checkpoint.summary.lastOutcome = failedThisRun > 0 ? 'completed-with-failures' : 'completed';
  await saveCheckpoint(options.checkpointFile, checkpoint, log);

  log.info('');
  log.info('============================================================');
  log.info('Summary');
  log.info('============================================================');
  log.info(`Processed this run:   ${processedThisRun}`);
  log.info(`  Succeeded:          ${successThisRun}`);
  log.info(`  Skipped:            ${skippedThisRun}`);
  log.info(`  Failed:             ${failedThisRun}`);
  log.info(`Total time:           ${formatDuration(totalTime)}`);
  log.info(`Average per image:    ${processedThisRun > 0 ? `${(totalTime / processedThisRun / 1000).toFixed(2)}s` : 'n/a'}`);
  log.info(`Checkpoint file:      ${options.checkpointFile}`);

  if (errors.length > 0) {
    log.info('');
    log.info('Recent errors:');
    for (const entry of errors.slice(0, 20)) {
      log.info(`  ${entry.imageId} | ${entry.filename} | ${entry.status ?? 'n/a'} | ${entry.message}`);
    }
    if (errors.length > 20) {
      log.info(`  ... plus ${errors.length - 20} more`);
    }
  }

  if (failedThisRun > 0) {
    process.exitCode = 1;
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH;

if (isDirectRun) {
  main().catch((error) => {
    console.error('[embedding-backfill] Fatal:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
