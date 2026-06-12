import type { RuntimeToolResult } from '../types.js';
export declare function textResult(text: string): RuntimeToolResult;
export declare function jsonResult(value: unknown): RuntimeToolResult;
export declare function errorResult(text: string): RuntimeToolResult;
