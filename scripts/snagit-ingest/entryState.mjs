import path from 'node:path';
import { buildLogicalSourceFingerprint } from './source-records.mjs';

const nowIso = () => new Date().toISOString();

export function ensureEntryShape(existingEntry, item, stat) {
  const baseStat = stat ? buildLogicalSourceFingerprint(item.absolutePath, stat) : {};
  return {
    sourceType: item.sourceType, assetKind: item.assetKind, relativePath: item.relativePath,
    rootDir: item.rootDir, absolutePath: path.resolve(item.absolutePath), ...baseStat, ...existingEntry,
    phases: {
      hydrate: { status: existingEntry?.phases?.hydrate?.status || 'pending', ...existingEntry?.phases?.hydrate },
      upload: { status: existingEntry?.phases?.upload?.status || 'pending', ...existingEntry?.phases?.upload },
      extras: { status: existingEntry?.phases?.extras?.status || 'pending', ...existingEntry?.phases?.extras },
      embeddings: { status: existingEntry?.phases?.embeddings?.status || 'pending', ...existingEntry?.phases?.embeddings },
      dehydrate: { status: existingEntry?.phases?.dehydrate?.status || 'pending', ...existingEntry?.phases?.dehydrate },
    },
  };
}

export function markPhase(entry, phase, patch) {
  return { ...entry, updatedAt: nowIso(), phases: { ...entry.phases, [phase]: { ...entry.phases[phase], ...patch } } };
}

export function markFreshSource(entry, item, stat, sourceContentHash) {
  return { ...entry, ...buildLogicalSourceFingerprint(item.absolutePath, stat), sourceContentHash };
}

export function uploadResultToAssetId(outcome) {
  return outcome?.payload?.id || outcome?.payload?.result?.id || (Array.isArray(outcome?.payload?.duplicates)
    ? outcome.payload.duplicates.find((duplicate) => duplicate && typeof duplicate.id === 'string')?.id : undefined);
}

export function uploadPhaseFromOutcome(outcome) {
  if (outcome.ok) return 'uploaded';
  if (outcome.status === 409 && Array.isArray(outcome.payload?.duplicates) && outcome.payload.duplicates.length > 0) return 'duplicate';
  return 'failed';
}
