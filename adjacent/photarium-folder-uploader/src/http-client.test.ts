import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpPhotariumClient } from './http-client.js';

test('HTTP client uploads to the configured namespace and enriches the returned image', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'photarium-folder-uploader-'));
  const filePath = path.join(directory, 'scene.png');
  await writeFile(filePath, 'png bytes');
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    if (calls.length === 1) return new Response(JSON.stringify({ id: 'image-123' }), { status: 200 });
    return new Response(JSON.stringify({ saved: true }), { status: 200 });
  };

  const client = new HttpPhotariumClient('http://localhost:3000/', fetchMock);
  const uploaded = await client.uploadFromPath(filePath, 'studio');
  await client.generateDescription(uploaded.imageId);
  await client.generateTags(uploaded.imageId, 8);

  assert.equal(uploaded.imageId, 'image-123');
  assert.equal(calls[0].url, 'http://localhost:3000/api/upload/external');
  assert.equal((calls[0].init?.body as FormData).get('namespace'), 'studio');
  assert.equal(calls[1].url, 'http://localhost:3000/api/images/image-123/description');
  assert.equal(calls[2].url, 'http://localhost:3000/api/images/image-123/tags');
  assert.equal(JSON.parse(String(calls[2].init?.body)).count, 8);
});
