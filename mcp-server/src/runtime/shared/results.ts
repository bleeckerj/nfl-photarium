import type { RuntimeToolResult } from '../types.js';

export function textResult(text: string): RuntimeToolResult {
  return { content: [{ type: 'text', text }] };
}

export function jsonResult(value: unknown): RuntimeToolResult {
  return textResult(JSON.stringify(value, null, 2));
}

export function errorResult(text: string): RuntimeToolResult {
  return { ...textResult(text), isError: true };
}
