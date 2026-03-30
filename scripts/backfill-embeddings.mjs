#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const DEFAULT_BATCH = 10;
const DEFAULT_DELAY_MS = 1000;
const DEFAULT_THROTTLE_MS = 150;
const DEFAULT_HEARTBEAT_MS = 5000;
const LIVE_STATUS_CHUNK_SIZE = 100;
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

const checkpointConfigValue = (value) => {
  if (value === null || value === undefined) return null;
  if (value === Infinity) return null;
  return value;
};

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

const createLogger = (options) => {
  const emit = (minimumLevel, prefix, args) => {
    if (options.verbose < minimumLevel) return;
    console.log(prefix, ...args);
  };

  return {
    info: (...args) => console.log(...args),
    verbose: (...args) => emit(1, '[verbose]', args),
    debug: (...args) => emit(2, '[debug]', args),
    trace: (...args) => emit(3, '[trace]', args),
    dump: (...args) => emit(4, '[dump]', args),
    insane: (...args) => emit(5, '[insane]', args),
  };
};

const hexToRgb = (hex) => {
  const match = String(hex || '').match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!match) return null;
  return {
    r: Number.parseInt(match[1], 16),
    g: Number.parseInt(match[2], 16),
    b: Number.parseInt(match[3], 16),
  };
};

const colorBlock = (hex) => {
  const rgb = hexToRgb(hex);
  if (!rgb) return '??';
  return `\x1b[48;2;${rgb.r};${rgb.g};${rgb.b}m  \x1b[0m`;
};

const colorBlocksRow = (hexColors) => {
  if (!Array.isArray(hexColors) || hexColors.length === 0) return '';
  return hexColors.map(colorBlock).join('');
};

const formatDuration = (ms) => {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
};

const createCheckpointSkeleton = (options, generateClip, generateColor) => ({
  version: 2,
  createdAt: nowIso(),
  updatedAt: nowIso(),
  profile: {
    apiBase: API_BASE,
    namespace: options.namespace,
    generateClip,
    generateColor,
    force: options.force,
    refresh: options.refresh,
    includeVectorMeta: options.includeVectorMeta,
    liveVerify: options.liveVerify,
  },
  config: {
    batch: checkpointConfigValue(options.batch),
    delay: checkpointConfigValue(options.delay),
    throttleMs: checkpointConfigValue(options.throttleMs),
    heartbeatMs: checkpointConfigValue(options.heartbeatMs),
    limit: checkpointConfigValue(options.limit),
    checkpointFile: options.checkpointFile,
  },
  summary: {
    lastRunStartedAt: null,
    lastRunFinishedAt: null,
    lastProcessedImageId: null,
    lastProcessedFilename: null,
    lastOutcome: null,
    resumedEntriesSkipped: 0,
    liveSatisfiedSkipped: 0,
  },
  entries: {},
});

async function loadCheckpoint(checkpointFile, options, generateClip, generateColor, log) {
  if (!options.resume) {
    return createCheckpointSkeleton(options, generateClip, generateColor);
  }

  try {
    const raw = await fs.readFile(checkpointFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Checkpoint JSON is not an object');
    }
    const checkpoint = {
      ...createCheckpointSkeleton(options, generateClip, generateColor),
      ...parsed,
      entries: parsed.entries && typeof parsed.entries === 'object' ? parsed.entries : {},
      summary: parsed.summary && typeof parsed.summary === 'object'
        ? { ...createCheckpointSkeleton(options, generateClip, generateColor).summary, ...parsed.summary }
        : createCheckpointSkeleton(options, generateClip, generateColor).summary,
    };
    log.verbose(`Loaded checkpoint: ${checkpointFile}`);
    return checkpoint;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      log.verbose(`Checkpoint not found, starting fresh: ${checkpointFile}`);
      return createCheckpointSkeleton(options, generateClip, generateColor);
    }
    throw error;
  }
}

function summarizeCheckpoint(checkpoint) {
  const summary = {
    success: 0,
    skipped: 0,
    failed: 0,
    running: 0,
    total: 0,
  };

  for (const entry of Object.values(checkpoint.entries || {})) {
    if (!entry || typeof entry !== 'object') continue;
    summary.total += 1;
    if (entry.status === 'success') summary.success += 1;
    else if (entry.status === 'skipped') summary.skipped += 1;
    else if (entry.status === 'failed') summary.failed += 1;
    else if (entry.status === 'running') summary.running += 1;
  }

  return summary;
}

async function saveCheckpoint(checkpointFile, checkpoint, log) {
  checkpoint.updatedAt = nowIso();
  checkpoint.checkpointStats = summarizeCheckpoint(checkpoint);
  await fs.mkdir(path.dirname(checkpointFile), { recursive: true });
  const tmpPath = `${checkpointFile}.tmp`;
  const payload = JSON.stringify(checkpoint, null, 2);
  await fs.writeFile(tmpPath, payload, 'utf8');
  await fs.rename(tmpPath, checkpointFile);
  log.insane(`Checkpoint saved: ${checkpointFile}`);
}

const requestedModeLabel = (generateClip, generateColor) => {
  if (generateClip && generateColor) return 'CLIP + color';
  if (generateClip) return 'CLIP';
  return 'color';
};

export function liveStateSatisfiesRequest(image, options) {
  const generateClip = !options.colorOnly;
  const generateColor = !options.clipOnly;
  const clipReady = !generateClip || Boolean(image.hasClipEmbedding);
  const colorReady = !generateColor || Boolean(image.hasColorEmbedding);
  return clipReady && colorReady;
}

export function resumeEntrySatisfiesRequest(entry, options) {
  if (!entry || typeof entry !== 'object') return false;
  if (entry.status !== 'success' && entry.status !== 'skipped') return false;
  if (Boolean(entry.force) !== Boolean(options.force)) return false;
  if (!options.colorOnly && !Boolean(entry.requestedClip)) return false;
  if (!options.clipOnly && !Boolean(entry.requestedColor)) return false;
  if (!options.colorOnly && !Boolean(entry.clipReady)) return false;
  if (!options.clipOnly && !Boolean(entry.colorReady)) return false;
  return true;
}

function needsEmbedding(image, options) {
  if (options.force) {
    return true;
  }
  const generateClip = !options.colorOnly;
  const generateColor = !options.clipOnly;
  const needsClip = generateClip && !image.hasClipEmbedding;
  const needsColor = generateColor && !image.hasColorEmbedding;
  return needsClip || needsColor;
}

async function fetchJson(url, init = undefined) {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function fetchJsonWithHeartbeat(url, init, { label, heartbeatMs, log }) {
  const startedAt = Date.now();
  let timer = null;

  if (heartbeatMs > 0) {
    timer = setInterval(() => {
      const elapsedMs = Date.now() - startedAt;
      log.verbose(`[wait] ${label} still in flight after ${formatDuration(elapsedMs)} (${elapsedMs}ms)`);
    }, heartbeatMs);
  }

  try {
    return await fetchJson(url, init);
  } finally {
    if (timer) {
      clearInterval(timer);
    }
  }
}

async function fetchImages(options, log) {
  const url = new URL(`${API_BASE}/api/images`);
  if (options.includeVectorMeta) {
    url.searchParams.set('includeVectorMeta', '1');
  }
  if (options.refresh) {
    url.searchParams.set('refresh', '1');
  }
  if (options.namespace === '__all__') {
    url.searchParams.set('namespace', '__all__');
  } else if (options.namespace === '') {
    url.searchParams.set('namespace', '__none__');
  } else if (options.namespace !== null) {
    url.searchParams.set('namespace', options.namespace);
  }

  log.info(`Fetching catalog from ${url.toString()}`);
  if (options.refresh) {
    log.info('Catalog mode: refreshing Cloudflare-backed cache before filtering worklist');
  } else {
    log.info('Catalog mode: using current cache state for a faster startup');
  }
  if (options.includeVectorMeta) {
    log.info('Catalog vector mode: asking /api/images to enrich list items from Redis before filtering');
  } else {
    log.info('Catalog vector mode: using cached list flags only; per-image POST still verifies Redis truth');
  }
  const startedAt = Date.now();
  const { response, payload } = await fetchJsonWithHeartbeat(url.toString(), undefined, {
    label: 'catalog fetch',
    heartbeatMs: options.heartbeatMs,
    log,
  });
  const elapsedMs = Date.now() - startedAt;
  log.debug(`Catalog response status=${response.status} elapsed=${elapsedMs}ms`);
  if (!response.ok) {
    throw new Error(payload?.error || `Failed to fetch images (${response.status})`);
  }
  log.trace(`Catalog payload count=${Array.isArray(payload?.images) ? payload.images.length : 0}`);
  if (payload?.timings) {
    log.dump('Catalog timings:', payload.timings);
  }
  return Array.isArray(payload?.images) ? payload.images : [];
}

async function postEmbeddings(imageId, generateClip, generateColor, force, log) {
  const url = `${API_BASE}/api/images/${imageId}/embeddings`;
  const body = {
    clip: generateClip,
    color: generateColor,
    force,
  };

  log.debug(`POST ${url}`);
  log.trace(`POST body=${JSON.stringify(body)}`);
  const startedAt = Date.now();
  const { response, payload } = await fetchJsonWithHeartbeat(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, {
    label: `embedding POST ${imageId}`,
    heartbeatMs: 5000,
    log,
  });
  const elapsedMs = Date.now() - startedAt;

  log.debug(`Embedding response status=${response.status} elapsed=${elapsedMs}ms image=${imageId}`);
  log.dump('Embedding response payload:', payload);

  if (!response.ok) {
    const error = new Error(payload?.error || `Embedding request failed (${response.status})`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return {
    payload,
    status: response.status,
    elapsedMs,
  };
}

async function fetchLiveEmbeddingStatus(images, options, log) {
  if (!options.liveVerify || images.length === 0) {
    return {
      images,
      driftClip: 0,
      driftColor: 0,
    };
  }

  const totalChunks = Math.ceil(images.length / LIVE_STATUS_CHUNK_SIZE);
  log.info(`Verifying live Redis embedding status in ${totalChunks} chunk${totalChunks === 1 ? '' : 's'} of ${LIVE_STATUS_CHUNK_SIZE}...`);

  const liveStatus = new Map();
  for (let index = 0; index < images.length; index += LIVE_STATUS_CHUNK_SIZE) {
    const chunk = images.slice(index, index + LIVE_STATUS_CHUNK_SIZE);
    const chunkNumber = Math.floor(index / LIVE_STATUS_CHUNK_SIZE) + 1;
    const chunkIds = chunk.map((image) => image.id);
    const url = `${API_BASE}/api/images/colors?ids=${encodeURIComponent(chunkIds.join(','))}`;

    const { response, payload } = await fetchJsonWithHeartbeat(url, undefined, {
      label: `live status chunk ${chunkNumber}/${totalChunks}`,
      heartbeatMs: options.heartbeatMs,
      log,
    });

    if (!response.ok) {
      throw new Error(payload?.error || `Failed to verify live embedding status (${response.status})`);
    }

    const colors = payload?.colors && typeof payload.colors === 'object' ? payload.colors : {};
    for (const imageId of chunkIds) {
      liveStatus.set(imageId, colors[imageId] || null);
    }

    if (
      options.verbose >= 1 ||
      totalChunks <= 20 ||
      chunkNumber === 1 ||
      chunkNumber === totalChunks ||
      chunkNumber % 10 === 0
    ) {
      log.info(`Live status progress: chunk ${chunkNumber}/${totalChunks} (${Math.min(index + LIVE_STATUS_CHUNK_SIZE, images.length)}/${images.length} images)`);
    }
  }

  let driftClip = 0;
  let driftColor = 0;
  const merged = images.map((image) => {
    const live = liveStatus.get(image.id);
    if (!live) {
      return image;
    }

    const liveClip = Boolean(live.hasClipEmbedding);
    const liveColor = Boolean(live.hasColorEmbedding);
    if (Boolean(image.hasClipEmbedding) !== liveClip) {
      driftClip += 1;
    }
    if (Boolean(image.hasColorEmbedding) !== liveColor) {
      driftColor += 1;
    }

    return {
      ...image,
      hasClipEmbedding: liveClip,
      hasColorEmbedding: liveColor,
      dominantColors: live.dominantColors ?? image.dominantColors,
      averageColor: live.averageColor ?? image.averageColor,
    };
  });

  return {
    images: merged,
    driftClip,
    driftColor,
  };
}

function createEntryBase(image, options, generateClip, generateColor, previousEntry = undefined) {
  return {
    imageId: image.id,
    filename: image.filename,
    namespace: image.namespace ?? null,
    requestedClip: generateClip,
    requestedColor: generateColor,
    force: options.force,
    attempts: (previousEntry?.attempts || 0) + 1,
    clipReady: Boolean(image.hasClipEmbedding),
    colorReady: Boolean(image.hasColorEmbedding),
    clipGenerated: false,
    colorGenerated: false,
    lastDurationMs: null,
    lastHttpStatus: null,
    lastError: null,
    completedAt: null,
    updatedAt: nowIso(),
  };
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
