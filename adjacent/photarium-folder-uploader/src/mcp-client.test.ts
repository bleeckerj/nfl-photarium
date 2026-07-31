import { test } from 'node:test';
import assert from 'node:assert/strict';
import { McpPhotariumClient, type McpSession, type SessionFactory } from './mcp-client.js';
import type { ConnectionConfig } from './types.js';

test('MCP client validates required tools and calls the shared workflow tools', async () => {
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  const session: McpSession = {
    async connect() {},
    async listTools() {
      return {
        tools: [
          { name: 'photarium_upload_from_path' },
          { name: 'photarium_generate_description' },
          { name: 'photarium_generate_tags' },
        ],
      };
    },
    async callTool(params) {
      calls.push(params);
      return { content: [{ type: 'text', text: JSON.stringify({ id: 'image-456', saved: true }) }] };
    },
    async close() {},
  };
  const transport = { close: async () => undefined } as never;
  const config: Extract<ConnectionConfig, { mode: 'mcp' }> = { mode: 'mcp', command: 'node' };
  const factory: SessionFactory = () => ({ session, transport });
  const client = new McpPhotariumClient(config, factory);
  await client.connect();
  const uploaded = await client.uploadFromPath('/tmp/scene.png', 'studio');
  await client.generateDescription(uploaded.imageId);
  await client.generateTags(uploaded.imageId, 6);
  await client.close();

  assert.equal(uploaded.imageId, 'image-456');
  assert.deepEqual(calls.map((call) => call.name), [
    'photarium_upload_from_path',
    'photarium_generate_description',
    'photarium_generate_tags',
  ]);
  assert.deepEqual(calls[2].arguments, { imageId: 'image-456', count: 6 });
});
