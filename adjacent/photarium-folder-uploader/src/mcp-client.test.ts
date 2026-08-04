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
          { name: 'photarium_tag_enrichment_status' },
        ],
      };
    },
    async callTool(params) {
      calls.push(params);
      const payload = params.name === 'photarium_upload_from_path'
        ? { id: 'image-456', saved: true, semanticTagging: { jobId: 'job-456', state: 'queued' } }
        : params.name === 'photarium_tag_enrichment_status'
          ? { state: 'succeeded' }
          : { id: 'image-456', saved: true };
      return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
    },
    async close() {},
  };
  const transport = { close: async () => undefined } as never;
  const config: Extract<ConnectionConfig, { mode: 'mcp' }> = { mode: 'mcp', command: 'node' };
  const factory: SessionFactory = () => ({ session, transport });
  const client = new McpPhotariumClient(config, factory);
  await client.connect();
  const uploaded = await client.uploadFromPath('/tmp/scene.png', 'studio', ['screenshot'], 8);
  await client.generateDescription(uploaded.imageId);
  const status = await client.getSemanticTagStatus('job-456');
  await client.close();

  assert.equal(uploaded.imageId, 'image-456');
  assert.deepEqual(calls[0].arguments, {
    filePath: '/tmp/scene.png',
    namespace: 'studio',
    tags: ['screenshot'],
    semanticTagCount: 8,
  });
  assert.deepEqual(calls.map((call) => call.name), [
    'photarium_upload_from_path',
    'photarium_generate_description',
    'photarium_tag_enrichment_status',
  ]);
  assert.equal(status.state, 'succeeded');
});
