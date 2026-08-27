import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FolderWatcher } from './watcher.js';
import type { PhotariumClient, UploaderConfig } from './types.js';

function config(directory: string): UploaderConfig {
  return {
    watchPath: directory,
    namespace: 'studio',
    stateFile: path.join(directory, 'state', 'checkpoint.json'),
    tags: ['screenshot'],
    connection: { mode: 'http', baseUrl: 'http://localhost:3000' },
    extensions: ['.png'],
    tagCount: 8,
    stability: { pollMs: 1, checks: 2 },
    retry: { maxAttempts: 1, delayMs: 1 },
    concurrency: 1,
  };
}

function fakeClient(): PhotariumClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async connect() {},
    async uploadFromPath(_filePath, _namespace, tags, semanticTagCount) {
      assert.deepEqual(tags, ['screenshot']);
      assert.equal(semanticTagCount, 8);
      calls.push('upload');
      return { imageId: 'image-789', semanticTagging: { jobId: 'job-789', state: 'queued' } };
    },
    async generateDescription() {
      calls.push('description');
    },
    async getSemanticTagStatus() {
      calls.push('tags');
      return { state: 'succeeded' };
    },
    async close() {},
  };
}

test('processes only top-level images and resumes enrichment without re-uploading', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'photarium-folder-uploader-'));
  await writeFile(path.join(directory, 'scene.png'), 'same bytes');
  await writeFile(path.join(directory, 'notes.txt'), 'ignored');
  await mkdir(path.join(directory, 'nested'), { recursive: true });
  await writeFile(path.join(directory, 'nested', 'nested.png'), 'ignored nested');
  const client = fakeClient();
  const first = new FolderWatcher(config(directory), client, { logger: () => undefined });
  await first.start();
  await first.stop();
  assert.deepEqual(client.calls, ['upload', 'description', 'tags']);

  const samePathClient = fakeClient();
  const samePath = new FolderWatcher(config(directory), samePathClient, { logger: () => undefined });
  await samePath.start();
  await samePath.stop();
  assert.deepEqual(samePathClient.calls, []);

  const renamed = path.join(directory, 'renamed.png');
  await writeFile(renamed, 'same bytes');
  const secondClient = fakeClient();
  const second = new FolderWatcher(config(directory), secondClient, { logger: () => undefined });
  await second.start();
  await second.stop();
  assert.deepEqual(secondClient.calls, []);
  assert.match(await readFile(config(directory).stateFile, 'utf8'), /image-789/);
  assert.match(await readFile(config(directory).stateFile, 'utf8'), /"size"/);
});

test('processes top-level videos and marks the upload complete', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'photarium-folder-uploader-'));
  const filePath = path.join(directory, 'recording.mp4');
  await writeFile(filePath, 'video bytes');
  const calls: string[] = [];
  const client = {
    ...fakeClient(),
    async uploadVideoFromPath() {
      calls.push('video-upload');
      return { assetType: 'video' as const, imageId: 'video-789', videoId: 'video-789' };
    },
  };
  const watcher = new FolderWatcher({ ...config(directory), extensions: ['.mp4'] }, client, { logger: () => undefined });
  await watcher.start();
  await watcher.stop();

  assert.deepEqual(calls, ['video-upload']);
  const state = await readFile(config(directory).stateFile, 'utf8');
  assert.match(state, /"assetType": "video"/);
  assert.match(state, /video-789/);
});

test('keeps an uploaded image checkpoint when tag generation fails', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'photarium-folder-uploader-'));
  await writeFile(path.join(directory, 'scene.png'), 'partial bytes');
  let tagAttempts = 0;
  const client: PhotariumClient = {
    async connect() {},
    async uploadFromPath() { return { imageId: 'image-partial', semanticTagging: { jobId: 'job-partial', state: 'queued' } }; },
    async generateDescription() {},
    async getSemanticTagStatus() {
      tagAttempts += 1;
      return { state: 'failed', error: 'tag service unavailable' };
    },
    async close() {},
  };
  const watcher = new FolderWatcher(config(directory), client, { logger: () => undefined });
  await watcher.start();
  await watcher.stop();
  const state = await readFile(config(directory).stateFile, 'utf8');
  assert.match(state, /image-partial/);
  assert.match(state, /tag service unavailable/);
  assert.equal(tagAttempts, 1);
});
