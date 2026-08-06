import fs from 'node:fs/promises';
import path from 'node:path';

const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const LIVE_STATUS_CHUNK_SIZE = 100;

const checkpointConfigValue = (value) => value === null || value === undefined || value === Infinity ? null : value;
const nowIso = () => new Date().toISOString();

export const createLogger = (options) => {
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
  return { r: Number.parseInt(match[1], 16), g: Number.parseInt(match[2], 16), b: Number.parseInt(match[3], 16) };
};

const colorBlock = (hex) => {
  const rgb = hexToRgb(hex);
  return rgb ? `\x1b[48;2;${rgb.r};${rgb.g};${rgb.b}m  \x1b[0m` : '??';
};

export const colorBlocksRow = (hexColors) => !Array.isArray(hexColors) || hexColors.length === 0 ? '' : hexColors.map(colorBlock).join('');

export const formatDuration = (ms) => {
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
  profile: { apiBase: API_BASE, namespace: options.namespace, generateClip, generateColor, force: options.force, refresh: options.refresh, includeVectorMeta: options.includeVectorMeta, liveVerify: options.liveVerify },
  config: { batch: checkpointConfigValue(options.batch), delay: checkpointConfigValue(options.delay), throttleMs: checkpointConfigValue(options.throttleMs), heartbeatMs: checkpointConfigValue(options.heartbeatMs), limit: checkpointConfigValue(options.limit), checkpointFile: options.checkpointFile },
  summary: { lastRunStartedAt: null, lastRunFinishedAt: null, lastProcessedImageId: null, lastProcessedFilename: null, lastOutcome: null, resumedEntriesSkipped: 0, liveSatisfiedSkipped: 0 },
  entries: {},
});

export async function loadCheckpoint(checkpointFile, options, generateClip, generateColor, log) {
  if (!options.resume) return createCheckpointSkeleton(options, generateClip, generateColor);
  try {
    const parsed = JSON.parse(await fs.readFile(checkpointFile, 'utf8'));
    if (!parsed || typeof parsed !== 'object') throw new Error('Checkpoint JSON is not an object');
    const fresh = createCheckpointSkeleton(options, generateClip, generateColor);
    const checkpoint = { ...fresh, ...parsed, entries: parsed.entries && typeof parsed.entries === 'object' ? parsed.entries : {}, summary: parsed.summary && typeof parsed.summary === 'object' ? { ...fresh.summary, ...parsed.summary } : fresh.summary };
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
  const summary = { success: 0, skipped: 0, failed: 0, running: 0, total: 0 };
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

export async function saveCheckpoint(checkpointFile, checkpoint, log) {
  checkpoint.updatedAt = nowIso();
  checkpoint.checkpointStats = summarizeCheckpoint(checkpoint);
  await fs.mkdir(path.dirname(checkpointFile), { recursive: true });
  const tmpPath = `${checkpointFile}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(checkpoint, null, 2), 'utf8');
  await fs.rename(tmpPath, checkpointFile);
  log.insane(`Checkpoint saved: ${checkpointFile}`);
}

export const requestedModeLabel = (generateClip, generateColor) => generateClip && generateColor ? 'CLIP + color' : generateClip ? 'CLIP' : 'color';

export function liveStateSatisfiesRequest(image, options) {
  const generateClip = !options.colorOnly;
  const generateColor = !options.clipOnly;
  return (!generateClip || Boolean(image.hasClipEmbedding)) && (!generateColor || Boolean(image.hasColorEmbedding));
}

export function resumeEntrySatisfiesRequest(entry, options) {
  if (!entry || typeof entry !== 'object' || (entry.status !== 'success' && entry.status !== 'skipped')) return false;
  if (Boolean(entry.force) !== Boolean(options.force)) return false;
  if (!options.colorOnly && (!entry.requestedClip || !entry.clipReady)) return false;
  if (!options.clipOnly && (!entry.requestedColor || !entry.colorReady)) return false;
  return true;
}

export const needsEmbedding = (image, options) => options.force || (!options.colorOnly && !image.hasClipEmbedding) || (!options.clipOnly && !image.hasColorEmbedding);

async function fetchJson(url, init = undefined) {
  const response = await fetch(url, init);
  return { response, payload: await response.json().catch(() => ({})) };
}

async function fetchJsonWithHeartbeat(url, init, { label, heartbeatMs, log }) {
  const startedAt = Date.now();
  const timer = heartbeatMs > 0 ? setInterval(() => {
    const elapsedMs = Date.now() - startedAt;
    log.verbose(`[wait] ${label} still in flight after ${formatDuration(elapsedMs)} (${elapsedMs}ms)`);
  }, heartbeatMs) : null;
  try { return await fetchJson(url, init); } finally { if (timer) clearInterval(timer); }
}

export async function fetchImages(options, log) {
  const url = new URL(`${API_BASE}/api/images`);
  if (options.includeVectorMeta) url.searchParams.set('includeVectorMeta', '1');
  if (options.refresh) url.searchParams.set('refresh', '1');
  if (options.namespace === '__all__') url.searchParams.set('namespace', '__all__');
  else if (options.namespace === '') url.searchParams.set('namespace', '__none__');
  else if (options.namespace !== null) url.searchParams.set('namespace', options.namespace);
  log.info(`Fetching catalog from ${url.toString()}`);
  log.info(options.refresh ? 'Catalog mode: refreshing Cloudflare-backed cache before filtering worklist' : 'Catalog mode: using current cache state for a faster startup');
  log.info(options.includeVectorMeta ? 'Catalog vector mode: asking /api/images to enrich list items from Redis before filtering' : 'Catalog vector mode: using cached list flags only; per-image POST still verifies Redis truth');
  const startedAt = Date.now();
  const { response, payload } = await fetchJsonWithHeartbeat(url.toString(), undefined, { label: 'catalog fetch', heartbeatMs: options.heartbeatMs, log });
  log.debug(`Catalog response status=${response.status} elapsed=${Date.now() - startedAt}ms`);
  if (!response.ok) throw new Error(payload?.error || `Failed to fetch images (${response.status})`);
  log.trace(`Catalog payload count=${Array.isArray(payload?.images) ? payload.images.length : 0}`);
  if (payload?.timings) log.dump('Catalog timings:', payload.timings);
  return Array.isArray(payload?.images) ? payload.images : [];
}

export async function postEmbeddings(imageId, generateClip, generateColor, force, log) {
  const url = `${API_BASE}/api/images/${imageId}/embeddings`;
  const body = { clip: generateClip, color: generateColor, force };
  log.debug(`POST ${url}`);
  log.trace(`POST body=${JSON.stringify(body)}`);
  const startedAt = Date.now();
  const { response, payload } = await fetchJsonWithHeartbeat(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, { label: `embedding POST ${imageId}`, heartbeatMs: 5000, log });
  const elapsedMs = Date.now() - startedAt;
  log.debug(`Embedding response status=${response.status} elapsed=${elapsedMs}ms image=${imageId}`);
  log.dump('Embedding response payload:', payload);
  if (!response.ok) {
    const error = new Error(payload?.error || `Embedding request failed (${response.status})`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return { payload, status: response.status, elapsedMs };
}

export async function fetchLiveEmbeddingStatus(images, options, log) {
  if (!options.liveVerify || images.length === 0) return { images, driftClip: 0, driftColor: 0 };
  const totalChunks = Math.ceil(images.length / LIVE_STATUS_CHUNK_SIZE);
  log.info(`Verifying live Redis embedding status in ${totalChunks} chunk${totalChunks === 1 ? '' : 's'} of ${LIVE_STATUS_CHUNK_SIZE}...`);
  const liveStatus = new Map();
  for (let index = 0; index < images.length; index += LIVE_STATUS_CHUNK_SIZE) {
    const chunk = images.slice(index, index + LIVE_STATUS_CHUNK_SIZE);
    const chunkNumber = Math.floor(index / LIVE_STATUS_CHUNK_SIZE) + 1;
    const chunkIds = chunk.map((image) => image.id);
    const { response, payload } = await fetchJsonWithHeartbeat(`${API_BASE}/api/images/colors?ids=${encodeURIComponent(chunkIds.join(','))}`, undefined, { label: `live status chunk ${chunkNumber}/${totalChunks}`, heartbeatMs: options.heartbeatMs, log });
    if (!response.ok) throw new Error(payload?.error || `Failed to verify live embedding status (${response.status})`);
    const colors = payload?.colors && typeof payload.colors === 'object' ? payload.colors : {};
    for (const imageId of chunkIds) liveStatus.set(imageId, colors[imageId] || null);
    if (options.verbose >= 1 || totalChunks <= 20 || chunkNumber === 1 || chunkNumber === totalChunks || chunkNumber % 10 === 0) log.info(`Live status progress: chunk ${chunkNumber}/${totalChunks} (${Math.min(index + LIVE_STATUS_CHUNK_SIZE, images.length)}/${images.length} images)`);
  }
  let driftClip = 0;
  let driftColor = 0;
  const merged = images.map((image) => {
    const live = liveStatus.get(image.id);
    if (!live) return image;
    const liveClip = Boolean(live.hasClipEmbedding);
    const liveColor = Boolean(live.hasColorEmbedding);
    if (Boolean(image.hasClipEmbedding) !== liveClip) driftClip += 1;
    if (Boolean(image.hasColorEmbedding) !== liveColor) driftColor += 1;
    return { ...image, hasClipEmbedding: liveClip, hasColorEmbedding: liveColor, dominantColors: live.dominantColors ?? image.dominantColors, averageColor: live.averageColor ?? image.averageColor };
  });
  return { images: merged, driftClip, driftColor };
}

export function createEntryBase(image, options, generateClip, generateColor, previousEntry = undefined) {
  return { imageId: image.id, filename: image.filename, namespace: image.namespace ?? null, requestedClip: generateClip, requestedColor: generateColor, force: options.force, attempts: (previousEntry?.attempts || 0) + 1, clipReady: Boolean(image.hasClipEmbedding), colorReady: Boolean(image.hasColorEmbedding), clipGenerated: false, colorGenerated: false, lastDurationMs: null, lastHttpStatus: null, lastError: null, completedAt: null, updatedAt: nowIso() };
}
