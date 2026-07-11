import { afterEach, describe, expect, it, vi } from 'vitest';

import { allToolContracts } from '../mcp-server/src/contracts/index.js';
import { handleRuntimeToolCall, RUNTIME_TOOL_HANDLERS, RUNTIME_TOOLS } from '../mcp-server/src/runtime/index.js';

const HIGH_RISK_SCHEMA_NAMES = [
  'photarium_search',
  'photarium_upload_url',
  'photarium_upload_from_path',
  'photarium_crop_variant',
  'photarium_image_tool_run',
  'photarium_image_tool_preview',
  'photarium_generate_image',
  'photarium_generate_tags',
  'photarium_aspect_ratio_variant',
  'photarium_semantic_merge',
  'photarium_fs_ingest',
  'photarium_instagram_ingest_profile',
  'photarium_instagram_ingest_single_url',
  'photarium_instagram_recover_videos',
  'photarium_backup',
  'photarium_rename_namespace',
  'photarium_delete_namespace',
] as const;

const realFetch = global.fetch;

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

describe('Photarium MCP runtime surface', () => {
  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('keeps runtime tool definitions aligned with registered contracts', () => {
    expect(sorted(allToolContracts.map((contract) => contract.name))).toEqual(
      sorted(RUNTIME_TOOLS.map((tool) => tool.name)),
    );
  });

  it('has exactly one runtime handler for each tool definition', () => {
    const toolNames = RUNTIME_TOOLS.map((tool) => tool.name);
    expect(new Set(toolNames).size).toBe(toolNames.length);
    expect(sorted(RUNTIME_TOOL_HANDLERS.keys())).toEqual(sorted(toolNames));
  });

  it('snapshots representative high-risk tool schemas', () => {
    const schemaByName = Object.fromEntries(
      HIGH_RISK_SCHEMA_NAMES.map((name) => {
        const tool = RUNTIME_TOOLS.find((candidate) => candidate.name === name);
        if (!tool) {
          throw new Error(`Missing runtime tool: ${name}`);
        }
        return [name, tool.inputSchema];
      }),
    );

    expect(schemaByName).toMatchSnapshot();
  });

  it('list_tools reports the composed runtime tool definitions', async () => {
    const result = await handleRuntimeToolCall('list_tools');
    expect(result.isError).not.toBe(true);
    const payload = JSON.parse(result.content[0]?.text || '{}') as { tools?: Array<{ name: string }> };
    expect(sorted((payload.tools || []).map((tool) => tool.name))).toEqual(
      sorted(RUNTIME_TOOLS.map((tool) => tool.name)),
    );
  });

  it('generates semantic tags and saves them without replacing existing tags', async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url === 'http://localhost:3000/api/images/img-123' && !init?.method) {
        return new Response(JSON.stringify({
          image: {
            id: 'img-123',
            filename: 'portrait.png',
            variants: [],
            tags: ['grainrad', 'portrait'],
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      if (url === 'http://localhost:3000/api/images/img-123/tags' && init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toEqual({ count: 6 });
        return new Response(JSON.stringify({
          tags: ['Portrait', 'glasses', 'pixel'],
          model: 'tag-model',
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      if (url === 'http://localhost:3000/api/images/img-123/update' && init?.method === 'PATCH') {
        expect(JSON.parse(String(init.body))).toEqual({
          tags: ['grainrad', 'portrait', 'glasses', 'pixel'],
        });
        return new Response(JSON.stringify({
          id: 'img-123',
          filename: 'portrait.png',
          variants: [],
          tags: ['grainrad', 'portrait', 'glasses', 'pixel'],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      return new Response(JSON.stringify({ error: `Unexpected request: ${url}` }), { status: 500 });
    }) as typeof global.fetch;

    const result = await handleRuntimeToolCall('photarium_generate_tags', {
      imageId: 'img-123',
      count: 6,
    });
    const payload = JSON.parse(result.content[0]?.text || '{}');

    expect(result.isError).not.toBe(true);
    expect(payload).toEqual({
      imageId: 'img-123',
      generatedTags: ['Portrait', 'glasses', 'pixel'],
      appendedTags: ['glasses', 'pixel'],
      tags: ['grainrad', 'portrait', 'glasses', 'pixel'],
      model: 'tag-model',
      saved: true,
    });
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('defaults namespace rename calls to dry-run through the namespace API', async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      expect(url).toBe('http://localhost:3000/api/namespaces');
      expect(init?.method).toBe('PATCH');
      expect(JSON.parse(String(init?.body || '{}'))).toEqual({
        namespace: 'old-space',
        targetNamespace: 'new-space',
        dryRun: true,
      });
      return new Response(JSON.stringify({ namespace: 'old-space', targetNamespace: 'new-space', dryRun: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof global.fetch;

    const result = await handleRuntimeToolCall('photarium_rename_namespace', {
      namespace: 'old-space',
      targetNamespace: 'new-space',
    });
    const payload = JSON.parse(result.content[0]?.text || '{}');

    expect(result.isError).not.toBe(true);
    expect(payload).toEqual({ namespace: 'old-space', targetNamespace: 'new-space', dryRun: true });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('defaults namespace delete calls to dry-run through the namespace API', async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      expect(url).toBe('http://localhost:3000/api/namespaces');
      expect(init?.method).toBe('DELETE');
      expect(JSON.parse(String(init?.body || '{}'))).toEqual({
        namespace: 'old-space',
        dryRun: true,
      });
      return new Response(JSON.stringify({ namespace: 'old-space', targetNamespace: 'cf-default', dryRun: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof global.fetch;

    const result = await handleRuntimeToolCall('photarium_delete_namespace', {
      namespace: 'old-space',
    });
    const payload = JSON.parse(result.content[0]?.text || '{}');

    expect(result.isError).not.toBe(true);
    expect(payload).toEqual({ namespace: 'old-space', targetNamespace: 'cf-default', dryRun: true });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects live namespace MCP mutations without confirmation', async () => {
    global.fetch = vi.fn() as typeof global.fetch;

    const renameResult = await handleRuntimeToolCall('photarium_rename_namespace', {
      namespace: 'old-space',
      targetNamespace: 'new-space',
      dryRun: false,
    });
    const deleteResult = await handleRuntimeToolCall('photarium_delete_namespace', {
      namespace: 'old-space',
      dryRun: false,
    });

    expect(renameResult.isError).toBe(true);
    expect(renameResult.content[0]?.text).toContain('RENAME_NAMESPACE');
    expect(deleteResult.isError).toBe(true);
    expect(deleteResult.content[0]?.text).toContain('DELETE_NAMESPACE');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
