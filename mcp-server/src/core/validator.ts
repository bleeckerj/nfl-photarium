import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import type { JsonSchema, ValidationIssue } from '../contracts/types.js';
import { ToolValidationError } from '../contracts/types.js';

function joinPath(base: string, segment: string): string {
  if (!base) {
    return segment;
  }
  if (segment.startsWith('[')) {
    return `${base}${segment}`;
  }
  return `${base}.${segment}`;
}

function typeMatches(value: unknown, expected: string): boolean {
  switch (expected) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    case 'null':
      return value === null;
    default:
      return true;
  }
}

function validateValue(value: unknown, schema: JsonSchema | undefined, path: string): ValidationIssue[] {
  if (!schema || typeof schema !== 'object') {
    return [];
  }

  const issues: ValidationIssue[] = [];
  const objectSchema = schema as {
    type?: string | string[];
    enum?: unknown[];
    items?: JsonSchema;
    properties?: Record<string, JsonSchema>;
    required?: string[];
    additionalProperties?: boolean;
  };
  const typeSpec = objectSchema.type;
  const types = Array.isArray(typeSpec) ? typeSpec : typeSpec ? [typeSpec] : [];

  if (types.length > 0 && !types.some((type) => typeMatches(value, type))) {
    issues.push({
      path,
      message: `Expected ${types.join(' | ')}`,
    });
    return issues;
  }

  if (Array.isArray(objectSchema.enum) && !objectSchema.enum.some((item) => Object.is(item, value))) {
    issues.push({
      path,
      message: `Expected one of: ${objectSchema.enum.join(', ')}`,
    });
    return issues;
  }

  if (Array.isArray(value)) {
    const itemSchema = objectSchema.items;
    value.forEach((item, index) => {
      issues.push(...validateValue(item, itemSchema, joinPath(path, `[${index}]`)));
    });
    return issues;
  }

  if (value !== null && typeof value === 'object') {
    const properties = objectSchema.properties ?? {};
    const required = Array.isArray(objectSchema.required) ? objectSchema.required : [];
    const additionalProperties = objectSchema.additionalProperties ?? false;
    const record = value as Record<string, unknown>;

    for (const key of required) {
      if (!(key in record)) {
        issues.push({
          path: joinPath(path, key),
          message: 'Missing required field',
        });
      }
    }

    for (const [key, child] of Object.entries(record)) {
      if (!(key in properties)) {
        if (additionalProperties !== true) {
          issues.push({
            path: joinPath(path, key),
            message: 'Unknown field',
          });
        }
        continue;
      }
      issues.push(...validateValue(child, properties[key], joinPath(path, key)));
    }
  }

  return issues;
}

export function validateToolArgs(tool: Tool, args: Record<string, unknown>): Record<string, unknown> {
  const schema = tool.inputSchema as JsonSchema | undefined;
  const issues = validateValue(args, schema, '$');
  if (issues.length > 0) {
    throw new ToolValidationError(`Invalid input for ${tool.name}`, issues);
  }
  return args;
}
