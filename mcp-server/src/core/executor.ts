import type { ToolContract, ToolResult } from '../contracts/types.js';
import { ToolValidationError } from '../contracts/types.js';
import type { Logger } from '../logging.js';
import { ToolRegistry } from './registry.js';
import { validateToolArgs } from './validator.js';

export interface ToolExecutorContext {
  transport: 'stdio' | 'http';
}

export class ToolExecutor {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly logger: Logger,
  ) {}

  listTools() {
    return this.registry.listTools();
  }

  getTool(name: string): ToolContract {
    return this.registry.get(name);
  }

  async invoke(name: string, rawArgs: Record<string, unknown>, context: ToolExecutorContext): Promise<ToolResult> {
    const contract = this.registry.get(name);
    this.logger.debug('tool.invoke', {
      tool: name,
      transport: context.transport,
    });

    const validatedArgs = validateToolArgs(
      {
        name: contract.name,
        description: contract.description,
        inputSchema: contract.inputSchema,
      },
      rawArgs,
    );

    try {
      const result = await contract.handler(validatedArgs);
      this.logger.trace('tool.result', {
        tool: name,
        transport: context.transport,
        isError: result.isError === true,
      });
      return result;
    } catch (error) {
      if (error instanceof ToolValidationError) {
        throw error;
      }
      throw error;
    }
  }
}
