import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { handleRuntimeToolCall, RUNTIME_TOOLS } from '../runtime/index.js';
import type { ToolContract } from './types.js';

const RUNTIME_TOOL_MAP = new Map<string, Tool>(RUNTIME_TOOLS.map((tool) => [tool.name, tool]));

function getAcceptedKeys(tool: Tool): string[] {
  const schema = tool.inputSchema as { properties?: Record<string, unknown> } | undefined;
  return Object.keys(schema?.properties ?? {});
}

function normalizeSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return schema;
  }

  const record = schema as Record<string, unknown>;
  const normalized: Record<string, unknown> = { ...record };

  if (record.type === 'object') {
    normalized.additionalProperties = record.additionalProperties === true;
    if (record.properties && typeof record.properties === 'object' && !Array.isArray(record.properties)) {
      normalized.properties = Object.fromEntries(
        Object.entries(record.properties as Record<string, unknown>).map(([key, value]) => [key, normalizeSchema(value)]),
      );
    }
  }

  if (record.type === 'array' && record.items) {
    normalized.items = normalizeSchema(record.items);
  }

  return normalized;
}

export function createRuntimeToolContract(name: string): ToolContract {
  const tool = RUNTIME_TOOL_MAP.get(name);
  if (!tool) {
    throw new Error(`Runtime tool definition not found: ${name}`);
  }

  return {
    name: tool.name,
    description: tool.description ?? '',
    inputSchema: normalizeSchema(tool.inputSchema) as Tool['inputSchema'],
    acceptedKeys: getAcceptedKeys(tool),
    handler: async (args) => {
      const result = await handleRuntimeToolCall(name, args);
      return {
        content: result.content.map((entry) => ({
          type: 'text' as const,
          text: entry.text,
        })),
        ...(result.isError ? { isError: true } : {}),
      };
    },
  };
}
