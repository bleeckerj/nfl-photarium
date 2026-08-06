import { createHash } from 'node:crypto';
import {
  appendRunEvent,
  writeJsonAtomic,
} from './checkpoint.mjs';
import {
  defaultProbeReportBase,
} from './cli.mjs';
import {
  detectProviderFileState,
  readPrefix,
  statSafe,
  walkSupportedFiles,
} from './source-records.mjs';
import { evictHydratedFile, hydrateFileIfNeeded } from './provider-operations.mjs';

async function buildProbeSelection(files, statsByPath, options) {
  const selected = [];
  let totalBytes = 0;
  for (const item of files) {
    const stat = statsByPath.get(item.absolutePath);
    if (!stat || !(await detectProviderFileState(item.absolutePath, stat)).placeholderLikely) continue;
    if (selected.length >= options.probeMaxFiles) break;
    const proposed = totalBytes + Math.max(1, stat.size);
    if (proposed > options.probeMaxBytes && selected.length > 0) break;
    selected.push(item);
    totalBytes = proposed;
  }
  return { selected, totalBytes };
}

export async function runProbe(options, logger, classifyProbeCapability) {
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
    command: 'probe', roots: options.roots, selectedCount: selection.selected.length,
    scannedCount: files.length, placeholderCandidates: selection.selected.length,
    capabilityVerdict: null, note: '',
  };
  const results = [];

  if (selection.selected.length === 0) {
    summary.note = 'no_likely_placeholders_found';
    await writeJsonAtomic(jsonPath, { summary, results });
    logger.warn('No likely Dropbox/File Provider placeholders found under the supplied roots.');
    logger.info(`Probe report: ${jsonPath}`);
    return;
  }

  for (const item of selection.selected) {
    const initialStat = statsByPath.get(item.absolutePath) || await statSafe(item.absolutePath);
    if (!initialStat) continue;
    const before = { size: initialStat.size, mtimeMs: Math.trunc(initialStat.mtimeMs) };
    const hydrate = await hydrateFileIfNeeded(item, initialStat, options, logger);
    let afterHydrateSize = null;
    let sampleHash = null;
    let sampleBytesRead = 0;
    if (hydrate.stat) {
      afterHydrateSize = hydrate.stat.size;
      const prefix = await readPrefix(item.absolutePath, Math.min(options.probeReadBytes, hydrate.stat.size || options.probeReadBytes)).catch(() => Buffer.alloc(0));
      sampleBytesRead = prefix.length;
      sampleHash = prefix.length > 0 ? createHash('sha256').update(prefix).digest('hex') : null;
    }
    let evict = { status: 'skipped', placeholderAfterEvict: false, command: null, error: null };
    if (hydrate.hydratedByScript) evict = await evictHydratedFile(item, options, logger);
    const result = {
      path: item.absolutePath, relativePath: item.relativePath, sourceType: item.sourceType,
      providerHint: Boolean(hydrate.providerHint), placeholderLikely: hydrate.placeholderLikely,
      xattrNames: hydrate.xattrNames, before, hydrated: Boolean(hydrate.stat),
      hydrateCommand: hydrate.commandAttempted, hydrateCommandSupported: hydrate.commandSupported,
      hydrateError: hydrate.error || null, hydrateElapsedMs: hydrate.hydrateElapsedMs || null,
      afterHydrateSize, sampleBytesRead, sampleHash, evictStatus: evict.status,
      evictCommand: evict.command, evictError: evict.error || null,
      placeholderAfterEvict: evict.placeholderAfterEvict,
    };
    results.push(result);
    await appendRunEvent(ndjsonPath, result);
  }

  summary.capabilityVerdict = classifyProbeCapability(results);
  await writeJsonAtomic(jsonPath, { summary, results });
  logger.info(`Probe verdict: ${summary.capabilityVerdict}`);
  logger.info(`Probe report: ${jsonPath}`);
}
