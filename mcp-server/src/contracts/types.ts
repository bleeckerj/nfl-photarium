import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export type JsonSchema =
  | {
      type?: string | string[];
      description?: string;
      enum?: unknown[];
      properties?: Record<string, JsonSchema>;
      required?: string[];
      items?: JsonSchema;
      additionalProperties?: boolean;
    }
  | Record<string, unknown>;

export type ToolResult = {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }
  >;
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

export class ToolValidationError extends Error {
  constructor(
    message: string,
    readonly issues: ValidationIssue[],
  ) {
    super(message);
    this.name = 'ToolValidationError';
  }
}

export class ToolContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolContractError';
  }
}

export class ToolNotFoundError extends Error {
  constructor(readonly toolName: string) {
    super(`Unknown tool: ${toolName}`);
    this.name = 'ToolNotFoundError';
  }
}
