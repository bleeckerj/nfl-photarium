import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContract } from '../contracts/types.js';
export declare class ToolRegistry {
    private readonly contractMap;
    constructor(contracts: ToolContract[]);
    list(): ToolContract[];
    listTools(): Tool[];
    get(name: string): ToolContract;
}
