import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { RuntimeToolHandler, RuntimeToolResult } from './types.js';
export declare const RUNTIME_TOOLS: Tool[];
export declare const RUNTIME_TOOL_HANDLERS: Map<string, RuntimeToolHandler>;
export declare function handleRuntimeToolCall(name: string, args?: Record<string, unknown>): Promise<RuntimeToolResult>;
