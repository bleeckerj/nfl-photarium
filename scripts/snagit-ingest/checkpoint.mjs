import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export function normalizeRelativePath(relPath) {
  return String(relPath || '').split(path.sep).join('/');
}

function nowIso() {
  return new Date().toISOString();
}

function stableRootKey(rootDir) {
  return createHash('sha1').update(path.resolve(rootDir)).digest('hex').slice(0, 16);
}

export function checkpointEntryKey(rootDir, relPath) {
  return `${stableRootKey(rootDir)}\n${normalizeRelativePath(relPath)}`;
}

export function hashEntryKey(namespace, assetKind, sourceContentHash) {
  return `${namespace}\n${assetKind}\n${sourceContentHash}`;
}

function buildCheckpointShape(options) {
  return {
    schemaVersion: 1,
    namespace: options.namespace,
    roots: [...options.roots],
    providerMode: options.providerMode,
    updatedAt: nowIso(),
    entries: {},
    hashEntries: {},
  };
}

export async function loadCheckpoint(filePath, options) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return buildCheckpointShape(options);
    return {
      schemaVersion: 1,
      namespace: parsed.namespace || options.namespace,
      roots: Array.isArray(parsed.roots) ? parsed.roots : [...options.roots],
      providerMode: parsed.providerMode || options.providerMode,
      updatedAt: parsed.updatedAt || nowIso(),
      entries: parsed.entries && typeof parsed.entries === 'object' ? parsed.entries : {},
      hashEntries: parsed.hashEntries && typeof parsed.hashEntries === 'object' ? parsed.hashEntries : {},
    };
  } catch {
    return buildCheckpointShape(options);
  }
}

export async function writeJsonAtomic(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await fs.rename(tmpPath, filePath);
}

export async function appendRunEvent(filePath, event) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify({ at: nowIso(), ...event })}\n`, 'utf8');
}

export async function saveCheckpoint(filePath, checkpoint) {
  await writeJsonAtomic(filePath, {
    ...checkpoint,
    updatedAt: nowIso(),
  });
}
