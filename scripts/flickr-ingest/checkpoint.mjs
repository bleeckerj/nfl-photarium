import path from 'node:path';
import { SUCCESS_STATUSES } from './constants.mjs';
import { appendLine, readJsonIfExists, writeJsonAtomic } from './util.mjs';

export function createCheckpointShape(selectorKey) {
  return {
    schemaVersion: 1,
    selectorKey,
    updatedAt: new Date().toISOString(),
    entries: {},
  };
}

export async function loadCheckpoint(filePath, selectorKey) {
  const checkpoint = await readJsonIfExists(filePath, null);
  if (!checkpoint || typeof checkpoint !== 'object') {
    return createCheckpointShape(selectorKey);
  }
  return {
    schemaVersion: 1,
    selectorKey: checkpoint.selectorKey || selectorKey,
    updatedAt: checkpoint.updatedAt || new Date().toISOString(),
    entries: checkpoint.entries && typeof checkpoint.entries === 'object' ? checkpoint.entries : {},
  };
}

export async function saveCheckpoint(filePath, checkpoint) {
  const next = {
    ...checkpoint,
    updatedAt: new Date().toISOString(),
  };
  await writeJsonAtomic(filePath, next);
}

export function shouldSkipCheckpointEntry(entry, latestLastUpdate, resume) {
  if (!resume || !entry) return false;
  if (!SUCCESS_STATUSES.has(entry.status)) return false;
  if (!latestLastUpdate) return true;
  return String(entry.flickrLastUpdate || '') === String(latestLastUpdate);
}

export function buildEntryUpdate({
  existingEntry,
  status,
  listPhoto,
  photariumId,
  sourceUrl,
  errorMessage,
  folder,
  tags,
  displayName,
}) {
  return {
    ...existingEntry,
    status,
    photoId: listPhoto.id,
    title: listPhoto.title || existingEntry?.title || '',
    flickrLastUpdate: listPhoto.lastUpdate || existingEntry?.flickrLastUpdate || '',
    sourceUrl: sourceUrl || existingEntry?.sourceUrl || '',
    photariumId: photariumId || existingEntry?.photariumId || '',
    folder: folder || existingEntry?.folder || '',
    tags: tags || existingEntry?.tags || [],
    displayName: displayName || existingEntry?.displayName || '',
    attempts: Number(existingEntry?.attempts || 0) + 1,
    lastError: errorMessage || '',
    updatedAt: new Date().toISOString(),
  };
}

export async function appendRunEvent(runLogFile, event) {
  await appendLine(runLogFile, JSON.stringify({
    at: new Date().toISOString(),
    ...event,
  }));
}

export function checkpointSummary(checkpoint) {
  const entries = Object.values(checkpoint.entries || {});
  const totals = {
    uploaded: 0,
    duplicate: 0,
    failed: 0,
    unsupported: 0,
    skipped: 0,
  };

  entries.forEach((entry) => {
    if (entry.status === 'uploaded') totals.uploaded += 1;
    else if (entry.status === 'duplicate' || entry.status === 'metadata-synced') totals.duplicate += 1;
    else if (entry.status === 'unsupported') totals.unsupported += 1;
    else if (entry.status === 'skipped-unchanged') totals.skipped += 1;
    else if (entry.status) totals.failed += 1;
  });

  return totals;
}

export function checkpointLogLabel(filePath) {
  return path.relative(process.cwd(), filePath) || filePath;
}

