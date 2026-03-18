import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import type { ToolContract } from '../contracts/types.js';
import { ToolContractError, ToolNotFoundError } from '../contracts/types.js';

export class ToolRegistry {
  private readonly contractMap = new Map<string, ToolContract>();

  constructor(contracts: ToolContract[]) {
    for (const contract of contracts) {
      if (this.contractMap.has(contract.name)) {
        throw new ToolContractError(`Duplicate tool name: ${contract.name}`);
      }
      if (typeof contract.handler !== 'function') {
        throw new ToolContractError(`Missing handler for tool: ${contract.name}`);
      }

      const schema = contract.inputSchema as { required?: string[] } | undefined;
      const requiredKeys = schema?.required ?? [];
      for (const key of requiredKeys) {
        if (!contract.acceptedKeys.includes(key)) {
          throw new ToolContractError(
            `Tool ${contract.name} requires schema field "${key}" that is not declared in acceptedKeys`,
          );
        }
      }

      this.contractMap.set(contract.name, contract);
    }
  }

  list(): ToolContract[] {
    return [...this.contractMap.values()];
  }

  listTools(): Tool[] {
    return this.list().map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    }));
  }

  get(name: string): ToolContract {
    const contract = this.contractMap.get(name);
    if (!contract) {
      throw new ToolNotFoundError(name);
    }
    return contract;
  }
}
