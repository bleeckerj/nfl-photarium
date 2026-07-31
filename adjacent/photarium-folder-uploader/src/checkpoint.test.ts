import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkpointKey, hashFile, loadCheckpoint, markStage, saveCheckpoint } from './checkpoint.js';

test('hashes identical content consistently and keys by namespace', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'photarium-folder-uploader-'));
  const first = path.join(directory, 'first.png');
  const second = path.join(directory, 'renamed.png');
  await writeFile(first, 'same image bytes');
  await writeFile(second, 'same image bytes');

  const firstHash = await hashFile(first);
  assert.equal(await hashFile(second), firstHash);
  assert.equal(checkpointKey('studio', firstHash), `studio\n${firstHash}`);
});

test('saves checkpoints atomically and preserves completed stages', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'photarium-folder-uploader-'));
  const statePath = path.join(directory, 'nested', 'state.json');
  const entry = {
    namespace: 'studio',
    contentHash: 'abc',
    lastPath: 'image.png',
    completed: [] as import('./types.js').MetadataStage[],
    attempts: 1,
    updatedAt: new Date().toISOString(),
  } as const;
  const checkpoint = { version: 1 as const, entries: { abc: entry } };
  await saveCheckpoint(statePath, checkpoint);
  const loaded = await loadCheckpoint(statePath);
  loaded.entries.abc = markStage(loaded.entries.abc, 'uploaded');
  await saveCheckpoint(statePath, loaded);

  assert.equal((await loadCheckpoint(statePath)).entries.abc.completed[0], 'uploaded');
  assert.equal(await readFile(statePath, 'utf8').then((value) => value.endsWith('\n')), true);
});
