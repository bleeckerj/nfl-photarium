import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Checkpoint, CheckpointEntry, MetadataStage } from './types.js';

const EMPTY_CHECKPOINT: Checkpoint = { version: 1, entries: {} };

export async function loadCheckpoint(filePath: string): Promise<Checkpoint> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8')) as Partial<Checkpoint>;
    if (parsed.version !== 1 || !parsed.entries || typeof parsed.entries !== 'object') return structuredClone(EMPTY_CHECKPOINT);
    return { version: 1, entries: parsed.entries as Record<string, CheckpointEntry> };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(EMPTY_CHECKPOINT);
    throw error;
  }
}

export async function saveCheckpoint(filePath: string, checkpoint: Checkpoint): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
  await fs.rename(temporaryPath, filePath);
}

export function checkpointKey(namespace: string, contentHash: string): string {
  return `${namespace}\n${contentHash}`;
}

export async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const file = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let bytesRead = 0;
    do {
      const result = await file.read(buffer, 0, buffer.byteLength, null);
      bytesRead = result.bytesRead;
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    await file.close();
  }
  return hash.digest('hex');
}

export function markStage(entry: CheckpointEntry, stage: MetadataStage): CheckpointEntry {
  return entry.completed.includes(stage)
    ? entry
    : { ...entry, completed: [...entry.completed, stage], lastError: undefined, updatedAt: new Date().toISOString() };
}
