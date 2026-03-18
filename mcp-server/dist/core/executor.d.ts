import type { ToolContract, ToolResult } from '../contracts/types.js';
import type { Logger } from '../logging.js';
import { ToolRegistry } from './registry.js';
export interface ToolExecutorContext {
    transport: 'stdio' | 'http';
}
export declare class ToolExecutor {
    private readonly registry;
    private readonly logger;
    constructor(registry: ToolRegistry, logger: Logger);
    listTools(): {
        inputSchema: {
            [x: string]: unknown;
            type: "object";
            properties?: {
                [x: string]: object;
            } | undefined;
            required?: string[] | undefined;
        };
        name: string;
        description?: string | undefined;
        outputSchema?: {
            [x: string]: unknown;
            type: "object";
            properties?: {
                [x: string]: object;
            } | undefined;
            required?: string[] | undefined;
        } | undefined;
        annotations?: {
            title?: string | undefined;
            readOnlyHint?: boolean | undefined;
            destructiveHint?: boolean | undefined;
            idempotentHint?: boolean | undefined;
            openWorldHint?: boolean | undefined;
        } | undefined;
        execution?: {
            taskSupport?: "optional" | "required" | "forbidden" | undefined;
        } | undefined;
        _meta?: {
            [x: string]: unknown;
        } | undefined;
        icons?: {
            src: string;
            mimeType?: string | undefined;
            sizes?: string[] | undefined;
            theme?: "light" | "dark" | undefined;
        }[] | undefined;
        title?: string | undefined;
    }[];
    getTool(name: string): ToolContract;
    invoke(name: string, rawArgs: Record<string, unknown>, context: ToolExecutorContext): Promise<ToolResult>;
}
