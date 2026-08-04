import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, parseArgs } from './config.js';

test('loads JSON configuration and applies CLI overrides', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'photarium-folder-uploader-'));
  const configPath = path.join(directory, 'config.json');
  await writeFile(configPath, JSON.stringify({
    watchPath: './drop',
    namespace: 'from-file',
    stateFile: './state.json',
    connection: { mode: 'http', baseUrl: 'http://photarium' },
    extensions: ['png'],
    tags: [' screenshot ', 'screenshot', 'reference'],
    tagCount: 4,
  }));

  const options = parseArgs(['--config', configPath, '--namespace', 'from-cli', '--tag-count', '6']);
  const config = await loadConfig(options);
  assert.equal(config.namespace, 'from-cli');
  assert.equal(config.tagCount, 6);
  assert.equal(config.extensions[0], '.png');
  assert.deepEqual(config.tags, ['screenshot', 'reference']);
  assert.equal(config.connection.mode, 'http');
  assert.equal(config.watchPath, path.join(directory, 'drop'));
});

test('parses MCP connection overrides without changing unrelated config', () => {
  const options = parseArgs(['--watch', '/tmp/drop', '--namespace', 'studio', '--mode', 'mcp', '--mcp-command', 'node', '--mcp-arg', 'server.js']);
  assert.equal(options.mode, 'mcp');
  assert.deepEqual(options.mcpArgs, ['server.js']);
  assert.equal(options.once, false);
});
