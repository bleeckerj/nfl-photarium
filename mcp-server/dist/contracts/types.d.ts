import type { Tool } from '@modelcontextprotocol/sdk/types.js';
export type JsonSchema = {
    type?: string | string[];
    description?: string;
    enum?: unknown[];
    properties?: Record<string, JsonSchema>;
    required?: string[];
    items?: JsonSchema;
    additionalProperties?: boolean;
} | Record<string, unknown>;
export type ToolResult = {
    content: Array<{
        type: 'text';
        text: string;
    } | {
        type: 'image';
        data: string;
        mimeType: string;
    }>;
    isError?: boolean;
};
export interface ToolContract {
    name: string;
    description: string;
    inputSchema: Tool['inputSchema'];
    handler: (args: Record<string, unknown>) => Promise<ToolResult>;
    acceptedKeys: readonly string[];
    aliases?: Readonly<Record<string, string>>;
}
export interface ValidationIssue {
    path: string;
    message: string;
}
export declare class ToolValidationError extends Error {
    readonly issues: ValidationIssue[];
    constructor(message: string, issues: ValidationIssue[]);
}
export declare class ToolContractError extends Error {
    constructor(message: string);
}
export declare class ToolNotFoundError extends Error {
    readonly toolName: string;
    constructor(toolName: string);
}
