import { describe, expect, it } from 'vitest';

import { ToolRegistry } from '../mcp-server/src/core/registry.js';
import type { ToolContract } from '../mcp-server/src/contracts/types.js';
import { ToolContractError } from '../mcp-server/src/contracts/types.js';

function contract(overrides: Partial<ToolContract> & Pick<ToolContract, 'name'>): ToolContract {
  return {
    name: overrides.name,
    description: overrides.description ?? overrides.name,
    inputSchema:
      overrides.inputSchema
      ?? {
        type: 'object',
        properties: {},
      },
    acceptedKeys: overrides.acceptedKeys ?? [],
    handler:
      'handler' in overrides
        ? (overrides.handler as ToolContract['handler'])
        : async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    aliases: overrides.aliases,
  };
}

describe('Photarium MCP contract startup checks', () => {
  it('fails on duplicate tool names', () => {
    expect(
      () =>
        new ToolRegistry([
          contract({ name: 'dup' }),
          contract({ name: 'dup' }),
        ]),
    ).toThrowError(new ToolContractError('Duplicate tool name: dup'));
  });

  it('fails when a handler is missing', () => {
    expect(
      () =>
        new ToolRegistry([
          contract({
            name: 'missing-handler',
            handler: undefined as unknown as ToolContract['handler'],
          }),
        ]),
    ).toThrowError(new ToolContractError('Missing handler for tool: missing-handler'));
  });

  it('fails when required schema fields are not satisfiable by accepted keys', () => {
    expect(
      () =>
        new ToolRegistry([
          contract({
            name: 'bad-schema',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string' },
              },
              required: ['query'],
            },
            acceptedKeys: [],
          }),
        ]),
    ).toThrowError(
      new ToolContractError(
        'Tool bad-schema requires schema field "query" that is not declared in acceptedKeys',
      ),
    );
  });
});
