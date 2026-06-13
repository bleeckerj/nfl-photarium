import { describe, expect, it } from 'vitest';

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
  'photarium_semantic_merge',
  'photarium_fs_ingest',
  'photarium_backup',
] as const;

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

describe('Photarium MCP runtime surface', () => {
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
});
