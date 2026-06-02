#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { splitCsv } from './fs-ingest/tagging.mjs';
import {
  defaultProbeReportBase,
  defaultRunLogPath,
  parseArgs,
  printUsage,
} from './snagit-ingest/cli.mjs';
import {
  appendRunEvent,
  checkpointEntryKey,
  hashEntryKey,
  loadCheckpoint,
  saveCheckpoint,
  writeJsonAtomic,
} from './snagit-ingest/checkpoint.mjs';
import {
  buildBaseTags,
  buildImageExtrasPayload,
  buildLogicalSourceFingerprint,
  detectProviderFileState,
  ensureImageEmbeddings,
  ensureVideoEmbeddings,
  extractSnagxInfo,
  patchImageExtras,
  readPrefix,
  sourceMatchesEntry,
  statSafe,
  uploadImageFile,
  uploadVideoFile,
  walkSupportedFiles,
} from './snagit-ingest/source-records.mjs';
import { evictHydratedFile, hydrateFileIfNeeded } from './snagit-ingest/provider-operations.mjs';

export { defaultCheckpointPath, defaultProbeReportBase, parseArgs } from './snagit-ingest/cli.mjs';
export { buildSnagitSourceRecord, deriveProviderFileState } from './snagit-ingest/source-records.mjs';

export const PROBE_VERDICTS = {
  supported: 'automated_hydrate_and_evict_supported',
  evictUnreliable: 'hydrate_supported_evict_unreliable',
  manualStage: 'hydrate_unsupported_manual_stage_required',
};

const supportsColor = (() => {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR === '0') return false;
  if (process.env.FORCE_COLOR) return true;
  return Boolean(process.stdout.isTTY);
})();

const color = {
  dim: (value) => (supportsColor ? `\x1b[2m${value}\x1b[0m` : value),
  cyan: (value) => (supportsColor ? `\x1b[36m${value}\x1b[0m` : value),
  blue: (value) => (supportsColor ? `\x1b[34m${value}\x1b[0m` : value),
  magenta: (value) => (supportsColor ? `\x1b[35m${value}\x1b[0m` : value),
  yellow: (value) => (supportsColor ? `\x1b[33m${value}\x1b[0m` : value),
  green: (value) => (supportsColor ? `\x1b[32m${value}\x1b[0m` : value),
  red: (value) => (supportsColor ? `\x1b[31m${value}\x1b[0m` : value),
  bold: (value) => (supportsColor ? `\x1b[1m${value}\x1b[0m` : value),
  white: (value) => (supportsColor ? `\x1b[97m${value}\x1b[0m` : value),
};

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function kv(label, value, labelColor = color.cyan, valueColor = color.white) {
  return `${labelColor(label)}=${valueColor(String(value))}`;
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let index = 0;
  let current = value;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  return `${current.toFixed(current >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function createLogger({ verbose = true, timestamps = true, quiet = false } = {}) {
  const emit = (tag, tagColor, message) => {
    const parts = [];
    if (timestamps) parts.push(color.dim(nowIso()));
    parts.push(tagColor(tag));
    parts.push(message);
    console.log(parts.join(' '));
  };

  return {
    banner(message) {
      if (quiet) return;
      emit('[snagit]', color.bold, color.bold(message));
    },
    info(message) {
      if (quiet) return;
      emit('[info]', color.cyan, message);
    },
    success(message) {
      if (quiet) return;
      emit('[ok]', color.green, message);
    },
    warn(message) {
      emit('[warn]', color.yellow, message);
    },
    error(message) {
      emit('[fail]', color.red, message);
    },
    debug(message) {
      if (!verbose) return;
      emit('[debug]', color.magenta, message);
    },
    heartbeat(message) {
      if (quiet) return;
      emit('[beat]', color.blue, message);
    },
  };
}

async function waitForThrottle(lastActionAt, throttleMs) {
  if (throttleMs <= 0) return Date.now();
  const waitMs = Math.max(0, (lastActionAt + throttleMs) - Date.now());
  if (waitMs > 0) {
    await sleep(waitMs);
  }
  return Date.now();
}

export function classifyProbeCapability(results) {
  if (!Array.isArray(results) || results.length === 0) return null;
  const hydrateSuccesses = results.filter((result) => result.hydrated === true);
  if (hydrateSuccesses.length === 0) {
    return PROBE_VERDICTS.manualStage;
  }
  const allEvicted = hydrateSuccesses.every((result) => result.placeholderAfterEvict === true);
  if (allEvicted) {
    return PROBE_VERDICTS.supported;
  }
  return PROBE_VERDICTS.evictUnreliable;
}

export function nextPendingIngestPhase(entry, { assetKind, ensureEmbeddings }) {
  const phases = entry?.phases || {};
  const uploadStatus = phases.upload?.status || 'pending';
  if (!['uploaded', 'duplicate', 'skipped-by-hash'].includes(uploadStatus)) {
    return 'upload';
  }
  if (assetKind === 'image') {
    const extrasStatus = phases.extras?.status || 'pending';
    if (!['done', 'skipped'].includes(extrasStatus)) {
      return 'extras';
    }
  }
  if (ensureEmbeddings) {
    const embeddingStatus = phases.embeddings?.status || 'pending';
    if (!['done', 'skipped'].includes(embeddingStatus)) {
      return 'embeddings';
    }
  }
  return null;
}

export function shouldStopForTranche(progress, options) {
  if (progress.actionedFiles >= options.trancheMaxFiles) {
    return `tranche-max-files=${options.trancheMaxFiles}`;
  }
  if (progress.actionedBytes >= options.trancheMaxBytes) {
    return `tranche-max-bytes=${options.trancheMaxBytes}`;
  }
  const elapsedMinutes = (Date.now() - progress.startedAt) / 60000;
  if (elapsedMinutes >= options.trancheMaxMinutes) {
    return `tranche-max-minutes=${options.trancheMaxMinutes}`;
  }
  return null;
}

async function buildProbeSelection(files, statsByPath, options) {
  const selected = [];
  let totalBytes = 0;
  for (const item of files) {
    const stat = statsByPath.get(item.absolutePath);
    if (!stat) continue;
    const providerState = await detectProviderFileState(item.absolutePath, stat);
    const placeholderLikely = providerState.placeholderLikely;
    if (!placeholderLikely) continue;
    if (selected.length >= options.probeMaxFiles) break;
    const proposed = totalBytes + Math.max(1, stat.size);
    if (proposed > options.probeMaxBytes && selected.length > 0) break;
    selected.push(item);
    totalBytes = proposed;
  }
  return {
    selected,
    totalBytes,
  };
}

async function runProbe(options, logger) {
  logger.banner('Snagit provider probe');
  logger.info(`roots=${options.roots.join(', ')}`);
  const files = await walkSupportedFiles(options.roots);
  const statsByPath = new Map();
  for (const item of files) {
    const stat = await statSafe(item.absolutePath);
    if (stat) statsByPath.set(item.absolutePath, stat);
  }

  const selection = await buildProbeSelection(files, statsByPath, options);
  const reportBase = options.reportPrefix || defaultProbeReportBase(options);
  const jsonPath = `${reportBase}.json`;
  const ndjsonPath = `${reportBase}.ndjson`;

  const summary = {
    command: 'probe',
    roots: options.roots,
    selectedCount: selection.selected.length,
    scannedCount: files.length,
    placeholderCandidates: selection.selected.length,
    capabilityVerdict: null,
    note: '',
  };

  const results = [];

  if (selection.selected.length === 0) {
    summary.note = 'no_likely_placeholders_found';
    await writeJsonAtomic(jsonPath, {
      summary,
      results,
    });
    logger.warn('No likely Dropbox/File Provider placeholders found under the supplied roots.');
    logger.info(`Probe report: ${jsonPath}`);
    return;
  }

  for (const item of selection.selected) {
    const initialStat = statsByPath.get(item.absolutePath) || await statSafe(item.absolutePath);
    if (!initialStat) continue;
    const before = {
      size: initialStat.size,
      mtimeMs: Math.trunc(initialStat.mtimeMs),
    };

    const hydrate = await hydrateFileIfNeeded(item, initialStat, options, logger);
    let afterHydrateSize = null;
    let sampleHash = null;
    let sampleBytesRead = 0;
    if (hydrate.stat) {
      afterHydrateSize = hydrate.stat.size;
      const prefix = await readPrefix(item.absolutePath, Math.min(options.probeReadBytes, hydrate.stat.size || options.probeReadBytes))
        .catch(() => Buffer.alloc(0));
      sampleBytesRead = prefix.length;
      sampleHash = prefix.length > 0 ? createHash('sha256').update(prefix).digest('hex') : null;
    }

    let evict = { status: 'skipped', placeholderAfterEvict: false, command: null, error: null };
    if (hydrate.hydratedByScript) {
      evict = await evictHydratedFile(item, options, logger);
    }

    const result = {
      path: item.absolutePath,
      relativePath: item.relativePath,
      sourceType: item.sourceType,
      providerHint: Boolean(hydrate.providerHint),
      placeholderLikely: hydrate.placeholderLikely,
      xattrNames: hydrate.xattrNames,
      before,
      hydrated: Boolean(hydrate.stat),
      hydrateCommand: hydrate.commandAttempted,
      hydrateCommandSupported: hydrate.commandSupported,
      hydrateError: hydrate.error || null,
      hydrateElapsedMs: hydrate.hydrateElapsedMs || null,
      afterHydrateSize,
      sampleBytesRead,
      sampleHash,
      evictStatus: evict.status,
      evictCommand: evict.command,
      evictError: evict.error || null,
      placeholderAfterEvict: evict.placeholderAfterEvict,
    };
    results.push(result);
    await appendRunEvent(ndjsonPath, result);
  }

  summary.capabilityVerdict = classifyProbeCapability(results);
  await writeJsonAtomic(jsonPath, {
    summary,
    results,
  });

  logger.info(`Probe verdict: ${summary.capabilityVerdict}`);
  logger.info(`Probe report: ${jsonPath}`);
}

function ensureEntryShape(existingEntry, item, stat) {
  const baseStat = stat ? buildLogicalSourceFingerprint(item.absolutePath, stat) : {};
  return {
    sourceType: item.sourceType,
    assetKind: item.assetKind,
    relativePath: item.relativePath,
    rootDir: item.rootDir,
    absolutePath: path.resolve(item.absolutePath),
    ...baseStat,
    ...existingEntry,
    phases: {
      hydrate: { status: existingEntry?.phases?.hydrate?.status || 'pending', ...existingEntry?.phases?.hydrate },
      upload: { status: existingEntry?.phases?.upload?.status || 'pending', ...existingEntry?.phases?.upload },
      extras: { status: existingEntry?.phases?.extras?.status || 'pending', ...existingEntry?.phases?.extras },
      embeddings: { status: existingEntry?.phases?.embeddings?.status || 'pending', ...existingEntry?.phases?.embeddings },
      dehydrate: { status: existingEntry?.phases?.dehydrate?.status || 'pending', ...existingEntry?.phases?.dehydrate },
    },
  };
}

function markPhase(entry, phase, patch) {
  return {
    ...entry,
    updatedAt: nowIso(),
    phases: {
      ...entry.phases,
      [phase]: {
        ...entry.phases[phase],
        ...patch,
      },
    },
  };
}

function markFreshSource(entry, item, stat, sourceContentHash) {
  const sourceFingerprint = buildLogicalSourceFingerprint(item.absolutePath, stat);
  return {
    ...entry,
    ...sourceFingerprint,
    sourceContentHash,
  };
}

function uploadResultToAssetId(outcome) {
  return outcome?.payload?.id
    || outcome?.payload?.result?.id
    || (Array.isArray(outcome?.payload?.duplicates)
      ? outcome.payload.duplicates.find((duplicate) => duplicate && typeof duplicate.id === 'string')?.id
      : undefined);
}

function uploadPhaseFromOutcome(outcome) {
  if (outcome.ok) return 'uploaded';
  if (outcome.status === 409 && Array.isArray(outcome.payload?.duplicates) && outcome.payload.duplicates.length > 0) {
    return 'duplicate';
  }
  return 'failed';
}

async function processIngestItem({
  item,
  options,
  checkpoint,
  logger,
  runState,
}) {
  const pathKey = checkpointEntryKey(item.rootDir, item.relativePath);
  const initialStat = await statSafe(item.absolutePath);
  if (!initialStat) {
    logger.warn(`missing file ${item.absolutePath}`);
    return { actioned: false, bytes: 0 };
  }

  let entry = ensureEntryShape(checkpoint.entries[pathKey], item, initialStat);
  const isComplete = nextPendingIngestPhase(entry, {
    assetKind: item.assetKind,
    ensureEmbeddings: options.ensureEmbeddings,
  }) === null;

  if (options.resume && isComplete && sourceMatchesEntry(entry, item.absolutePath, initialStat)) {
    logger.debug(`skip(cached) ${item.relativePath}`);
    return { actioned: false, bytes: 0 };
  }

  const hydrate = await hydrateFileIfNeeded(item, initialStat, options, logger);
  if (hydrate.error) {
    entry = markPhase(entry, 'hydrate', {
      status: options.providerMode === 'manual-stage' ? 'manual-stage' : 'failed',
      error: hydrate.error,
      command: hydrate.commandAttempted,
      attemptedAt: nowIso(),
    });
    checkpoint.entries[pathKey] = entry;
    if (!options.dryRun) {
      await saveCheckpoint(options.checkpointFile, checkpoint);
      await appendRunEvent(options.runLogFile, {
        type: 'hydrate-failed',
        path: item.absolutePath,
        relativePath: item.relativePath,
        error: hydrate.error,
      });
    }
    logger.error(`hydrate fail ${item.relativePath} -> ${hydrate.error}`);
    return { actioned: true, failed: true, bytes: 0 };
  }

  entry = markPhase(entry, 'hydrate', {
    status: hydrate.placeholderLikely ? 'done' : 'not-needed',
    hydratedByScript: hydrate.hydratedByScript,
    command: hydrate.commandAttempted,
    attemptedAt: nowIso(),
  });

  const readableStat = hydrate.stat || initialStat;
  const sourceBytes = await fs.readFile(item.absolutePath);
  const sourceContentHash = createHash('sha256').update(sourceBytes).digest('hex');
  entry = markFreshSource(entry, item, readableStat, sourceContentHash);

  const hashKey = hashEntryKey(options.namespace, item.assetKind, sourceContentHash);
  const cachedHashEntry = checkpoint.hashEntries[hashKey];
  if (options.resume && cachedHashEntry?.status === 'complete') {
    entry = markPhase(entry, 'upload', {
      status: 'skipped-by-hash',
      assetId: cachedHashEntry.assetId,
      completedAt: nowIso(),
    });
    if (item.assetKind === 'image') {
      entry = markPhase(entry, 'extras', { status: 'done', completedAt: nowIso() });
    } else {
      entry = markPhase(entry, 'extras', { status: 'skipped', completedAt: nowIso() });
    }
    entry = markPhase(entry, 'embeddings', {
      status: options.ensureEmbeddings ? 'done' : 'skipped',
      completedAt: nowIso(),
    });
    checkpoint.entries[pathKey] = entry;
    if (!options.dryRun) {
      await saveCheckpoint(options.checkpointFile, checkpoint);
      await appendRunEvent(options.runLogFile, {
        type: 'skip-hash',
        path: item.absolutePath,
        relativePath: item.relativePath,
        assetId: cachedHashEntry.assetId,
      });
    }

    if (hydrate.hydratedByScript) {
      const evict = await evictHydratedFile(item, options, logger);
      entry = markPhase(entry, 'dehydrate', {
        status: evict.status,
        command: evict.command,
        error: evict.error,
        completedAt: nowIso(),
      });
      checkpoint.entries[pathKey] = entry;
      if (!options.dryRun) {
        await saveCheckpoint(options.checkpointFile, checkpoint);
      }
      if (evict.status !== 'done' && evict.status !== 'skipped' && evict.status !== 'unsupported') {
        runState.evictFailures += 1;
        runState.retainedHydratedBytes += readableStat.size;
      }
    }

    logger.info(`skip(cached-hash) ${item.relativePath} -> ${cachedHashEntry.assetId}`);
    return { actioned: true, bytes: readableStat.size };
  }

  const phase = nextPendingIngestPhase(entry, {
    assetKind: item.assetKind,
    ensureEmbeddings: options.ensureEmbeddings,
  });

  let assetId = entry.phases.upload.assetId;

  if (phase === 'upload') {
    const tags = buildBaseTags(item, splitCsv(options.tagsCsv));
    if (options.dryRun) {
      logger.info(`dry-run upload ${item.relativePath} tags=${tags.join(',')}`);
      return { actioned: true, bytes: readableStat.size };
    }

    runState.lastUploadAt = await waitForThrottle(runState.lastUploadAt, options.throttleMs);

    const outcome = item.assetKind === 'image'
      ? await uploadImageFile({
          apiBase: options.apiBase,
          item,
          bytes: sourceBytes,
          namespace: options.namespace,
          folder: options.folder || undefined,
          tags,
        })
      : await uploadVideoFile({
          apiBase: options.apiBase,
          item,
          bytes: sourceBytes,
          namespace: options.namespace,
          folder: options.folder || undefined,
          tags,
        });

    const uploadStatus = uploadPhaseFromOutcome(outcome);
    assetId = uploadResultToAssetId(outcome);
    if (uploadStatus === 'failed' || !assetId) {
      const message = outcome.payload?.error
        || outcome.payload?.message
        || `HTTP ${outcome.status}`;
      entry = markPhase(entry, 'upload', {
        status: 'failed',
        error: message,
        completedAt: nowIso(),
      });
      checkpoint.entries[pathKey] = entry;
      await saveCheckpoint(options.checkpointFile, checkpoint);
      await appendRunEvent(options.runLogFile, {
        type: 'upload-failed',
        path: item.absolutePath,
        relativePath: item.relativePath,
        error: message,
      });
      logger.error(`upload fail ${item.relativePath} -> ${message}`);
      return { actioned: true, failed: true, bytes: readableStat.size };
    }

    entry = markPhase(entry, 'upload', {
      status: uploadStatus,
      assetId,
      completedAt: nowIso(),
    });
    checkpoint.entries[pathKey] = entry;
    await saveCheckpoint(options.checkpointFile, checkpoint);
    await appendRunEvent(options.runLogFile, {
      type: uploadStatus === 'duplicate' ? 'upload-duplicate' : 'upload-ok',
      path: item.absolutePath,
      relativePath: item.relativePath,
      assetId,
    });
    logger.success(`${uploadStatus === 'duplicate' ? 'duplicate' : 'upload'} ${item.relativePath} -> ${assetId}`);
  }

  assetId = assetId || entry.phases.upload.assetId;
  if (!assetId) {
    logger.error(`missing asset id after upload for ${item.relativePath}`);
    return { actioned: true, failed: true, bytes: readableStat.size };
  }

  if (item.assetKind === 'image' && entry.phases.extras.status !== 'done') {
    if (options.dryRun) {
      logger.info(`dry-run extras ${item.relativePath}`);
      return { actioned: true, bytes: readableStat.size };
    }

    let snagitInfo = null;
    if (item.sourceType === 'snagx') {
      try {
        snagitInfo = extractSnagxInfo(sourceBytes, path.basename(item.absolutePath));
      } catch (error) {
        logger.warn(`snagx metadata parse failed ${item.relativePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    try {
      await patchImageExtras({
        apiBase: options.apiBase,
        imageId: assetId,
        payload: buildImageExtrasPayload({
          item,
          stat: readableStat,
          sourceContentHash,
          snagitInfo,
          capturedAt: nowIso(),
        }),
      });
      entry = markPhase(entry, 'extras', {
        status: 'done',
        completedAt: nowIso(),
      });
      checkpoint.entries[pathKey] = entry;
      await saveCheckpoint(options.checkpointFile, checkpoint);
      await appendRunEvent(options.runLogFile, {
        type: 'extras-ok',
        path: item.absolutePath,
        relativePath: item.relativePath,
        assetId,
      });
      logger.debug(`extras ok ${item.relativePath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      entry = markPhase(entry, 'extras', {
        status: 'failed',
        error: message,
        completedAt: nowIso(),
      });
      checkpoint.entries[pathKey] = entry;
      await saveCheckpoint(options.checkpointFile, checkpoint);
      await appendRunEvent(options.runLogFile, {
        type: 'extras-failed',
        path: item.absolutePath,
        relativePath: item.relativePath,
        assetId,
        error: message,
      });
      logger.error(`extras fail ${item.relativePath} -> ${message}`);
      return { actioned: true, failed: true, bytes: readableStat.size };
    }
  } else if (item.assetKind !== 'image' && entry.phases.extras.status === 'pending') {
    entry = markPhase(entry, 'extras', {
      status: 'skipped',
      completedAt: nowIso(),
    });
  }

  if (options.ensureEmbeddings && entry.phases.embeddings.status !== 'done') {
    if (options.dryRun) {
      logger.info(`dry-run embeddings ${item.relativePath}`);
      return { actioned: true, bytes: readableStat.size };
    }

    try {
      if (item.assetKind === 'image') {
        await ensureImageEmbeddings({ apiBase: options.apiBase, imageId: assetId });
      } else {
        await ensureVideoEmbeddings({ apiBase: options.apiBase, videoId: assetId });
      }
      entry = markPhase(entry, 'embeddings', {
        status: 'done',
        completedAt: nowIso(),
      });
      checkpoint.entries[pathKey] = entry;
      checkpoint.hashEntries[hashKey] = {
        status: 'complete',
        namespace: options.namespace,
        assetKind: item.assetKind,
        sourceContentHash,
        assetId,
        sourcePath: item.relativePath,
        completedAt: nowIso(),
      };
      await saveCheckpoint(options.checkpointFile, checkpoint);
      await appendRunEvent(options.runLogFile, {
        type: 'embeddings-ok',
        path: item.absolutePath,
        relativePath: item.relativePath,
        assetId,
      });
      logger.debug(`embeddings ok ${item.relativePath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      entry = markPhase(entry, 'embeddings', {
        status: 'failed',
        error: message,
        completedAt: nowIso(),
      });
      checkpoint.entries[pathKey] = entry;
      await saveCheckpoint(options.checkpointFile, checkpoint);
      await appendRunEvent(options.runLogFile, {
        type: 'embeddings-failed',
        path: item.absolutePath,
        relativePath: item.relativePath,
        assetId,
        error: message,
      });
      logger.error(`embeddings fail ${item.relativePath} -> ${message}`);
      return { actioned: true, failed: true, bytes: readableStat.size };
    }
  } else if (!options.ensureEmbeddings && entry.phases.embeddings.status === 'pending') {
    entry = markPhase(entry, 'embeddings', {
      status: 'skipped',
      completedAt: nowIso(),
    });
    checkpoint.entries[pathKey] = entry;
    checkpoint.hashEntries[hashKey] = {
      status: 'complete',
      namespace: options.namespace,
      assetKind: item.assetKind,
      sourceContentHash,
      assetId,
      sourcePath: item.relativePath,
      completedAt: nowIso(),
    };
    if (!options.dryRun) {
      await saveCheckpoint(options.checkpointFile, checkpoint);
    }
  }

  if (hydrate.hydratedByScript) {
    if (options.dryRun) {
      logger.info(`dry-run dehydrate ${item.relativePath}`);
      return { actioned: true, bytes: readableStat.size };
    }
    const evict = await evictHydratedFile(item, options, logger);
    entry = markPhase(entry, 'dehydrate', {
      status: evict.status,
      command: evict.command,
      error: evict.error,
      completedAt: nowIso(),
    });
    checkpoint.entries[pathKey] = entry;
    await saveCheckpoint(options.checkpointFile, checkpoint);
    await appendRunEvent(options.runLogFile, {
      type: 'dehydrate',
      path: item.absolutePath,
      relativePath: item.relativePath,
      assetId,
      status: evict.status,
      command: evict.command,
      error: evict.error,
    });
    if (evict.status !== 'done' && evict.status !== 'skipped' && evict.status !== 'unsupported') {
      runState.evictFailures += 1;
      runState.retainedHydratedBytes += readableStat.size;
      logger.warn(`dehydrate fail ${item.relativePath} -> ${evict.error || evict.status}`);
    } else if (evict.status === 'unsupported') {
      logger.warn(`dehydrate unsupported ${item.relativePath}`);
    } else {
      logger.debug(`dehydrate ok ${item.relativePath}`);
    }
  } else if (entry.phases.dehydrate.status === 'pending') {
    entry = markPhase(entry, 'dehydrate', {
      status: 'skipped',
      completedAt: nowIso(),
    });
    checkpoint.entries[pathKey] = entry;
  }

  return { actioned: true, bytes: readableStat.size };
}

async function runIngest(options, logger) {
  logger.banner('Snagit archive ingest');
  logger.info(`roots=${options.roots.join(', ')}`);
  logger.info(`${kv('namespace', options.namespace)} ${kv('providerMode', options.providerMode)} ${kv('throttleMs', options.throttleMs)} ${kv('heartbeatMs', options.heartbeatMs)}`);
  logger.info(`${kv('checkpoint', options.checkpointFile)} ${kv('runlog', options.runLogFile || '[auto]')}`);

  const checkpoint = await loadCheckpoint(options.checkpointFile, options);
  const runLogFile = options.runLogFile || defaultRunLogPath(options);
  options.runLogFile = runLogFile;
  const files = await walkSupportedFiles(options.roots);
  logger.info(`scan files=${files.length}`);

  const runState = {
    lastUploadAt: 0,
    evictFailures: 0,
    retainedHydratedBytes: 0,
  };
  const progress = {
    startedAt: Date.now(),
    actionedFiles: 0,
    actionedBytes: 0,
    failedFiles: 0,
  };

  for (const item of files) {
    const outcome = await processIngestItem({
      item,
      options,
      checkpoint,
      logger,
      runState,
    });

    if (outcome.actioned) {
      progress.actionedFiles += 1;
      progress.actionedBytes += outcome.bytes || 0;
    }
    if (outcome.failed) {
      progress.failedFiles += 1;
    }

    if (runState.retainedHydratedBytes >= options.retainedHydratedBytesCap) {
      logger.warn(`stopping: retained hydrated bytes cap hit (${formatBytes(runState.retainedHydratedBytes)})`);
      break;
    }
    if (runState.evictFailures >= options.evictFailureCap) {
      logger.warn(`stopping: evict failure cap hit (${runState.evictFailures})`);
      break;
    }

    const trancheStopReason = shouldStopForTranche(progress, options);
    if (trancheStopReason) {
      logger.info(`stopping: ${trancheStopReason}`);
      break;
    }
  }

  logger.info(
    `done actioned=${progress.actionedFiles} failed=${progress.failedFiles} bytes=${formatBytes(progress.actionedBytes)} retainedHydratedBytes=${formatBytes(runState.retainedHydratedBytes)} evictFailures=${runState.evictFailures}`
  );
}

async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    printUsage();
    return;
  }

  const logger = createLogger({
    verbose: options.verbose,
    timestamps: options.timestamps,
    quiet: options.quiet,
  });

  if (options.command === 'probe') {
    await runProbe(options, logger);
    return;
  }

  await runIngest(options, logger);
}

const isMainModule = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
