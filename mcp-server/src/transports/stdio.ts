import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { ToolValidationError } from '../contracts/types.js';
import { SERVICE_NAME, SERVICE_VERSION } from '../diagnostics.js';
import type { ToolExecutor } from '../core/executor.js';
import type { Logger } from '../logging.js';

export async function startStdioTransport(executor: ToolExecutor, logger: Logger) {
  const server = createMcpServer(executor);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('stdio.ready');
  return server;
}

export function createMcpServer(executor: ToolExecutor) {
  const server = new Server(
    {
      name: SERVICE_NAME,
      version: SERVICE_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: executor.listTools(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      return await executor.invoke(name, ((args || {}) as Record<string, unknown>), {
        transport: 'stdio',
      });
    } catch (error) {
      if (error instanceof ToolValidationError) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  error: error.message,
                  issues: error.issues,
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}
